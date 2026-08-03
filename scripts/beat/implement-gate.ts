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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OBSERVATION_DIR, expectationPath, recordPath, type Expectation } from "../../hooks/work-implement-observation.ts";
import { sessionFlagKey } from "../../hooks/_gate_common.ts";
import { isGoverned } from "../../hooks/lib/governance-marker.ts";
import { episodeStatePath, initEpisodeState, readEpisodeState, writeEpisodeState } from "../../hooks/lib/episode-state.ts";

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
    | "violated"                // the AGENT wrote outside authority or misreported
    | "red-unproven"            // a declared redCommand did not run, or could not be judged
    | "red-not-red"             // it PASSED before implementation: the test does not pin the behaviour
    | "green-not-green";        // it still fails after implementation
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

    // RED/GREEN, ADJUDICATED FROM EXIT CODES THE HOOK OBSERVED — not from anything the agent said.
    // A declared redCommand must FAIL before the dispatch and PASS after. Both halves are load-bearing
    // and they catch different lies: a command that passed beforehand proves the test does not pin the
    // behaviour being built (the classic vacuous green — an assertion that was already true), while one
    // still failing afterwards proves the work is not done. Neither is visible in a filesystem delta,
    // which is why the observation records alone could never enforce TDD.
    const declaredRed = expectation.tasks[taskId]?.redCommand;
    if (declaredRed) {
      const preProbe = (pre as any).redProbe;
      const postProbe = (post as any).redProbe;
      const unusable = (probe: any, side: string): string | undefined => {
        if (!probe) return `the ${side}-dispatch observation carries no redProbe; the declared redCommand was never executed`;
        if (probe.command !== declaredRed) return `the ${side}-dispatch redProbe ran a different command than the plan declares`;
        if (probe.error) return `the ${side}-dispatch redCommand could not be executed: ${probe.error}`;
        if (probe.timedOut) return `the ${side}-dispatch redCommand timed out; a suite that never finished proves nothing either way`;
        if (typeof probe.exitCode !== "number") return `the ${side}-dispatch redCommand produced no exit status`;
        return undefined;
      };
      const preUnusable = unusable(preProbe, "pre");
      if (preUnusable) return { taskId, ok: false, reason: "red-unproven", detail: preUnusable };
      const postUnusable = unusable(postProbe, "post");
      if (postUnusable) return { taskId, ok: false, reason: "red-unproven", detail: postUnusable };
      if (preProbe.exitCode === 0) {
        return { taskId, ok: false, reason: "red-not-red", detail: `redCommand PASSED before implementation (exit 0), so it does not pin the behaviour this task builds: ${declaredRed}` };
      }
      if (postProbe.exitCode !== 0) {
        return { taskId, ok: false, reason: "green-not-green", detail: `redCommand still fails after implementation (exit ${postProbe.exitCode}): ${declaredRed}\n${String(postProbe.tail ?? "").slice(-1200)}` };
      }
    }

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
  //
  // THIS USED TO BE DEAD CODE. It probed `recordPath(session, "no-expectation", "", "pre")` — a
  // record keyed to an EMPTY task id, which the hook never writes: it only reaches recordPath once
  // it has resolved a non-empty id, and recordPath hashes that id, so nothing ever lands at that
  // filename. `unexpected` was therefore always `[]`, and a rogue dispatch alongside an authenticated
  // wave passed the gate silently. The records carry their own taskId, so read them instead of
  // trying to guess a path.
  const expectedIds = new Set(expected);
  const unexpected: string[] = [];
  try {
    for (const entry of readdirSync(OBSERVATION_DIR)) {
      if (!entry.startsWith(`${session}--`) || !entry.endsWith("--pre.json")) continue;
      const record = readJson(join(OBSERVATION_DIR, entry));
      const observedId = typeof record?.taskId === "string" ? record.taskId : undefined;
      if (!observedId) continue;
      const recordFingerprint = typeof record?.fingerprint === "string" ? record.fingerprint : "";
      // ORDER MATTERS HERE, AND GETTING IT WRONG HID A REAL DISPATCH.
      //
      // The `expectedIds` skip used to come FIRST, which let this sequence through: dispatch
      // `TASK a: rogue` BEFORE any preflight (recorded under the "no-expectation" key, mutating the
      // tree), then run a preflight whose wave happens to contain a legitimate task also called `a`.
      // The rogue record was skipped for having an expected id, and its mutations were already
      // folded into the legitimate task's baseline. A dispatch that ran with NO authenticated bounds
      // is unadjudicable whatever it is named, so that check has to precede the name check.
      // The remedy is named because this record outlives the wave: nothing prunes the current
      // session's files, so one pre-preflight dispatch refuses EVERY later wave in the session until
      // someone removes it. That persistence is deliberate — an unauthenticated dispatch should not
      // age out of the record — but a refusal with no route back is an operational dead end.
      if (recordFingerprint === "no-expectation") {
        unexpected.push(`${observedId} (dispatched before any preflight authenticated a wave; investigate, then remove ${join(OBSERVATION_DIR, entry)} to clear it)`);
        continue;
      }
      if (expectedIds.has(observedId)) continue;
      // A record from an EARLIER wave in the same session is not a rogue dispatch; only this wave's
      // fingerprint counts against it.
      if (recordFingerprint !== fingerprint) continue;
      unexpected.push(observedId);
    }
  } catch {
    // The directory is created by the hook; its absence means nothing was ever recorded, which the
    // per-task verdicts above already report as missing-pre. Never turn that into a second failure.
  }
  unexpected.sort();

  return { ok: verdicts.every(v => v.ok) && !unexpected.length, session, waveFingerprint: fingerprint, expected, verdicts, unexpected };
}

/**
 * Record that IMPLEMENT completed and that a REVIEW is now owed.
 *
 * WHY HERE AND NOT IN `gateWave`. `gateWave` is a pure function the test suite calls directly; moving
 * this inside it would make every one of those tests write episode state into whatever `projectDir`
 * its fixture named. The CLI entry is the only place that corresponds to a real run.
 *
 * WHY THIS IS WEAKER THAN A HOOK, STATED RATHER THAN GLOSSED. Everything else that writes
 * `.planning/.state/` is a hook, and therefore unforgeable by the conversation. This is a script the
 * orchestrator invokes with Bash, so the conversation controls whether it runs at all. THE RESIDUE IS
 * REAL: skipping the gate means no `implemented` phase and therefore no review debt, so an
 * orchestrator that never runs gate 1 is never asked for a review.
 *
 * That is not a regression — today there is no debt at any point — and it is bounded by the fact that
 * a wave cannot legitimately complete without gate 1, which `beat-implement` requires and whose
 * absence is itself a refusal. But it is not the same guarantee the hook-written phases carry, and it
 * should not be described as if it were. Closing it needs an observable event at the IMPLEMENT
 * boundary, which does not exist today.
 *
 * A FAILING GATE RECORDS NOTHING. The wave was refused, so IMPLEMENT did not complete; stamping a
 * phase there would let a refused wave discharge into REVIEW.
 */
function recordImplementPhase(session: string, result: { ok: boolean }): void {
  if (!result.ok) return;
  const expectation = readJson(expectationPath(session)) as Expectation | undefined;
  const projectDir = expectation?.projectDir;
  if (typeof projectDir !== "string" || !projectDir) return;
  if (!isGoverned(projectDir)) return;
  const existing = readEpisodeState(projectDir);
  // Absent is created; present-but-unreadable is left alone. Overwriting a state we cannot parse
  // would discard whatever phase or debt it held.
  if (existing === null && existsSync(episodeStatePath(projectDir))) return;
  const base = existing ?? initEpisodeState({ workflow: expectation?.workflow ?? "work", sessionId: session });
  writeEpisodeState(projectDir, {
    ...base,
    // Backfill a null session rather than leaving it null forever; see the note in
    // hooks/writing-suggest-verify.ts. Same gemini finding.
    sessionId: base.sessionId ?? session,
    phases: { ...base.phases, implemented: new Date().toISOString() },
    reviewOwed: true,
    // A FRESH DEBT GETS A FRESH BUDGET. Carrying the previous debt's count forward would silently
    // spend this one's refusals — a second IMPLEMENT would get a gate that never blocks.
    reviewBlocks: 0,
  });
}

if (import.meta.main) {
  const argv = process.argv;
  const session = argv[argv.indexOf("--session") + 1];
  if (!session || session.startsWith("--")) {
    console.error("implement-gate requires --session <dispatching session id>");
    process.exit(1);
  }
  const result = gateWave(session);
  recordImplementPhase(session, result);
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
