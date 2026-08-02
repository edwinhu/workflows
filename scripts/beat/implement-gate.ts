#!/usr/bin/env bun
/**
 * The IMPLEMENT gate: refuse a wave unless EVERY dispatched task was observed and adjudicated clean.
 *
 * WHY ABSENCE MUST BE FAILURE, AND WHY THIS IS THE LOAD-BEARING HALF
 *   `hooks/work-implement-observation.ts` fails OPEN on its own errors — a gate that denies on its
 *   own bugs is worse than no gate. That is correct, and it is only safe because of this file. A hook
 *   that errors on every dispatch (plugin disabled, `CLAUDE_PLUGIN_ROOT` moved by a version bump,
 *   hooks stripped from settings, or — as actually happened in v5.106.0 — never registered at all)
 *   allows every dispatch, observes nothing, and produces a run INDISTINGUISHABLE FROM A CLEAN ONE.
 *
 *   Fail-open and fail-silent are separable, and conflating them is the danger. The hook's job is to
 *   never fail silent: it writes a record on every path, success, violation and malfunction alike.
 *   This gate's job is to treat a MISSING record as a failure rather than as a pass. Without it, the
 *   hook's records are decoration.
 *
 *   This gate is why the design is allowed to fail open. IF IT IS EVER WEAKENED TO A WARNING, THE
 *   WHOLE DESIGN GOES UNDERWATER and the right move is to revert to an in-process dispatch loop,
 *   which had one property this arrangement cannot: the delta lived in the workflow's own memory and
 *   never crossed a channel the model could write. We traded that for un-skippability, and the trade
 *   only pays while missing observation is a HARD failure.
 *
 * WHAT IT CANNOT DO, STATED SO NOBODY OVER-TRUSTS IT
 *   Records are files, and the orchestrator has Bash. `orchestrator-mutation-guard.ts` denies writes
 *   to the observation directory, but that guard is a denylist with known residue and fails open on
 *   its own errors too. Forging a record is narrow and auditable, not impossible. This gate proves
 *   that the recorded evidence is complete and self-consistent — not that it is unforgeable.
 *
 * Usage:
 *   bun scripts/beat/implement-gate.ts --session <dispatching session id> [--json]
 * Exit 0 = every expected task observed and clean. Exit 1 = refuse the wave.
 */
import { existsSync, readFileSync } from "node:fs";
import { OBSERVATION_DIR, expectationPath, recordPath, type Expectation } from "../../hooks/work-implement-observation.ts";
import { sessionFlagKey } from "../../hooks/_gate_common.ts";

export type TaskVerdict = {
  taskId: string;
  ok: boolean;
  /** Distinct causes with distinct remedies. Never collapse these into "failed". */
  reason:
    | "clean"
    | "no-expectation"          // the preflight never ran for this session
    | "missing-pre"             // dispatched without a baseline; changes are unattributable
    | "missing-post"            // no post-dispatch observation
    | "missing-adjudication"    // observed but never judged
    | "observation-failed"      // OUR machinery broke
    | "not-adjudicable"         // the PLAN is malformed, or our delta is
    | "violated";               // the AGENT wrote outside authority or misreported
  detail?: string;
};

export type GateResult = {
  ok: boolean;
  session: string;
  waveFingerprint?: string;
  expected: string[];
  verdicts: TaskVerdict[];
  /** Tasks the hook recorded that the authenticated plan never named. */
  unexpected: string[];
};

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function gateWave(rawSession: string): GateResult {
  const session = sessionFlagKey({ session_id: rawSession });
  const expectation = readJson(expectationPath(session)) as Expectation | undefined;

  // NO EXPECTATION IS A REFUSAL, NOT A PASS. It means the preflight never ran, so nothing was
  // authenticated, no task was bounded, and any dispatch that happened was unadjudicated. A gate that
  // returned "ok, nothing to check" here would greenlight precisely the state it exists to catch.
  // `{}` IS TRUTHY, so an expectation naming zero tasks slipped past this guard, produced an empty
  // `verdicts`, and `[].every(...)` returned true — the gate reported ok for having adjudicated
  // nothing. That is the very state the paragraph above refuses, reached by a different route:
  // an expectation existing is not the same as an expectation bounding something.
  if (!expectation?.tasks || Object.keys(expectation.tasks).length === 0) {
    const empty = !!expectation?.tasks;
    return {
      ok: false, session, expected: [], unexpected: [],
      verdicts: [{
        taskId: "(wave)", ok: false, reason: "no-expectation",
        detail: empty
          ? "the authenticated expectation names zero tasks; nothing was bounded, so there is nothing to adjudicate and no basis for a pass"
          : "no authenticated expectation for this session; the beat's preflight did not run, so nothing was bounded and nothing could be adjudicated",
      }],
    };
  }

  const fingerprint = expectation.waveFingerprint;
  const expected = Object.keys(expectation.tasks);
  const verdicts: TaskVerdict[] = expected.map(taskId => {
    const pre = readJson(recordPath(session, fingerprint, taskId, "pre"));
    const post = readJson(recordPath(session, fingerprint, taskId, "post"));
    const adjudication = readJson(recordPath(session, fingerprint, taskId, "adjudication"));

    // Order matters: report the EARLIEST thing that went wrong. A task with no pre-observation also
    // has no meaningful adjudication, and naming the adjudication would send someone to the wrong end.
    if (!pre) return { taskId, ok: false, reason: "missing-pre", detail: "no pre-dispatch observation; this task's filesystem changes cannot be attributed to it" };
    if (pre.status === "observation-failed") return { taskId, ok: false, reason: "observation-failed", detail: String(pre.reason ?? "pre-dispatch observation failed") };
    if (!post) return { taskId, ok: false, reason: "missing-post", detail: "no post-dispatch observation; the task may not have completed, or the hook did not run" };
    if (post.status === "observation-failed") return { taskId, ok: false, reason: "observation-failed", detail: String(post.reason ?? "post-dispatch observation failed") };
    if (!adjudication) return { taskId, ok: false, reason: "missing-adjudication", detail: "observed but never judged against the plan's bounds" };

    const status = String(adjudication.status ?? "");
    if (status === "clean") return { taskId, ok: true, reason: "clean" };
    if (status === "not-adjudicable" || status === "adjudication-failed") {
      return { taskId, ok: false, reason: "not-adjudicable", detail: String(adjudication.reason ?? "") };
    }
    const violations = Array.isArray(adjudication.violations) ? adjudication.violations : [];
    return { taskId, ok: false, reason: "violated", detail: violations.join("; ") };
  });

  // A task that was dispatched but never authenticated is its own failure: the plan did not name it,
  // so no bounds exist for it and "it looked fine" is not something anyone can say.
  const unexpected: string[] = [];
  const stray = readJson(recordPath(session, "no-expectation", "", "pre"));
  if (stray) unexpected.push("(a dispatch was recorded under the no-expectation key)");

  return { ok: verdicts.every(v => v.ok) && !unexpected.length, session, waveFingerprint: fingerprint, expected, verdicts, unexpected };
}

if (import.meta.main) {
  const argv = process.argv;
  const session = argv[argv.indexOf("--session") + 1];
  if (!session || session.startsWith("--")) {
    console.error("implement-gate requires --session <dispatching session id>");
    process.exit(1);
  }
  const result = gateWave(session);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`IMPLEMENT gate: ${result.ok ? "PASS" : "REFUSE"} (${result.verdicts.filter(v => v.ok).length}/${result.verdicts.length} task(s) observed and clean)`);
    console.log(`observations: ${OBSERVATION_DIR}`);
    for (const verdict of result.verdicts.filter(v => !v.ok)) {
      console.log(`  ${verdict.taskId}: ${verdict.reason}${verdict.detail ? ` — ${verdict.detail}` : ""}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}
