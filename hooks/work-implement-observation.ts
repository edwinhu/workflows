#!/usr/bin/env bun
/**
 * IMPLEMENT-phase filesystem observation, as a hook pair around each Agent dispatch.
 *
 * WHY THIS IS A HOOK AND NOT PART OF A WORKFLOW SCRIPT
 *   `workflows/beat-implement.js` used to call `captureGitObservation` before and after every task
 *   inside its own dispatch loop. That script could never run: the Workflow runtime is pure control
 *   flow — no `import()`, no `process`, no `Buffer` — so it died at its first import and /work's
 *   implement step has never worked. Converting it was impossible for a reason no oracle placement
 *   fixes: the observation must happen BETWEEN dispatches. A pre-step runs before the moment exists;
 *   a post-step runs after per-task attribution is unrecoverable; a hook can allow or block but
 *   cannot return a delta INTO a workflow.
 *
 *   Hooks are subprocesses, so they can do all of it — fs, git, crypto, the real
 *   CLAUDE_CODE_SESSION_ID — and they bracket each Agent call whether the orchestrator cooperates or
 *   not. That un-skippability is the whole point: the alternative design put the loop in SKILL.md,
 *   which makes the safety property optional, because an implementer's violation is hidden by simply
 *   not running the observation step.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE — read before trusting it
 *   It DETECTS AND REFUSES TO ACCEPT. It does NOT PREVENT. PostToolUse fires after the tool has run:
 *   by the time this hook exists, the implementer's bytes are already on disk and nothing here can
 *   un-write them. What it can do is make sure a violating agent's "status: implemented" never
 *   reaches the model as a clean success (`updatedToolOutput`) and halt the run (`continue: false`).
 *   Anyone reading "blocks on violation" and concluding the tree was protected has been misled.
 *
 * FAIL OPEN ON OUR OWN ERRORS, BUT NEVER FAIL SILENT
 *   A gate that denies on its own bugs is worse than no gate — that failure cost this repo a day.
 *   So an internal error here NEVER denies a dispatch. But fail-open and fail-silent are separable,
 *   and conflating them is the actual danger: a hook that errors every time (plugin disabled,
 *   CLAUDE_PLUGIN_ROOT moved by a version bump, hooks stripped from settings) would allow every
 *   dispatch, observe nothing, and produce a run indistinguishable from a clean one. Silent is worse
 *   than loud. So every path — success, violation, and our own failure — writes a durable record,
 *   and the gate treats ABSENCE OF A RECORD AS FAILURE rather than as a pass.
 *
 * THE GATE IS LOAD-BEARING. IF IT IS EVER WEAKENED TO A WARNING, THIS WHOLE DESIGN GOES UNDERWATER
 * AND THE RIGHT MOVE IS TO REVERT TO THE IN-PROCESS LOOP. The in-process version had one property
 * this one cannot: the delta lived in the workflow's own memory and never crossed a channel the
 * model could write, so it was unforgeable by construction. We traded that for un-skippability. The
 * trade only pays while missing observation is a hard failure. See skills/beat-implement/SKILL.md,
 * "What this detects, and what it does not".
 *
 * RESIDUE WE DO NOT CLOSE, named here so nobody has to rediscover it:
 *   - Records are files, and the orchestrator has Bash. `orchestrator-mutation-guard.ts` denies
 *     writes to this directory, but that guard is a denylist with known residue (opaque executables,
 *     `python -c`, shell indirection) and it fails open on its own errors too. Forging a record is
 *     narrow and auditable, not impossible.
 *   - A swap completing entirely before a capture is invisible; the guarantee is self-consistency of
 *     the recorded tuple, not a global filesystem instant.
 *
 * Usage: --phase pre|post --workflow <ds|dev|work>
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sessionFlagKey, parsePayload, allow, context, pyJson } from "./_gate_common.ts";

/** Python's tempfile.gettempdir(): TMPDIR, TEMP, TMP, then the platform dirs, then cwd. */
function gettempdir(): string {
  for (const key of ["TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value) return value;
  }
  return "/tmp";
}

export const OBSERVATION_DIR = join(gettempdir(), "work-implement-observations");

/**
 * The dispatch prompt built for an implementation task opens with `TASK <id>: <name>` on its own
 * line (see the runner's promptFor). That marker is how a hook correlates an Agent call with the
 * task it is implementing — hooks receive the tool input, not the caller's variables. An Agent call
 * without the marker is not an implement dispatch (verifiers, reviewers, ad-hoc agents all pass
 * through here) and is left strictly alone.
 */
export function taskIdFrom(prompt: unknown): string | undefined {
  const match = /^TASK (\S+):/m.exec(String(prompt ?? ""));
  return match?.[1];
}

export type Expectation = {
  waveFingerprint: string;
  projectDir: string;
  workflow: string;
  /** taskId -> the bounds adjudication is judged against. DERIVED from the authenticated plan. */
  tasks: Record<string, { writablePaths: string[]; outputs: string[] }>;
};

export function expectationPath(sessionId: string): string {
  return join(OBSERVATION_DIR, `${sessionId}--expectation.json`);
}

/**
 * Records are keyed by (session, wave fingerprint, task) — NOT by task id alone.
 *
 * Task ids are unique and sequential WITHIN a wave (the runner throws on duplicates and awaits each
 * dispatch), but a RESUMED run replays the same ids in a different process, and a user running the
 * phase twice does the same. Keying on the id alone would let one run's pre-observation adjudicate
 * another run's task.
 */
export function recordPath(sessionId: string, fingerprint: string, taskId: string, phase: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  return join(OBSERVATION_DIR, `${safe(sessionId)}--${safe(fingerprint)}--${safe(taskId)}--${phase}.json`);
}

function loadExpectation(sessionId: string): Expectation | undefined {
  const path = expectationPath(sessionId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Expectation;
  } catch {
    return undefined;
  }
}

/** Always leaves a trace. This is the difference between failing open and failing silent. */
function writeRecord(path: string, body: Record<string, unknown>): void {
  try {
    mkdirSync(OBSERVATION_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify({ ...body, writtenAt: new Date().toISOString() }, null, 2));
  } catch {
    // Nothing left to do: we cannot record that we cannot record. The gate's absence check is the
    // backstop for exactly this, which is why it must stay a gate.
  }
}

if (import.meta.main) {
  const phase = process.argv.includes("--post") || process.argv[process.argv.indexOf("--phase") + 1] === "post" ? "post" : "pre";
  const raw = await new Response(Bun.stdin.stream()).text();

  let payload: Record<string, unknown>;
  try {
    payload = parsePayload(raw);
  } catch {
    // A malformed payload tells us nothing about which task this was, so there is no record to key.
    // Never deny on it.
    if (phase === "pre") allow();
    process.exit(0);
  }

  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const taskId = taskIdFrom(toolInput.prompt);
  // Not an implement dispatch. Silence is how a PostToolUse hook says "carry on" — an explicit
  // {"decision":"allow"} is REJECTED as invalid and discards the whole payload, which would turn a
  // pass into a deny. See ds-post-subagent-guard.
  if (!taskId) {
    if (phase === "pre") allow();
    process.exit(0);
  }

  const sessionId = sessionFlagKey(payload);
  const expectation = loadExpectation(sessionId);
  // No expectation means the preflight did not run. We still record, keyed so the gate can tell this
  // apart from a swept record: "never expected" and "expected but unobserved" have different causes
  // and different remedies, and collapsing them sends someone hunting a stale record when their real
  // problem is a missing preflight.
  const fingerprint = expectation?.waveFingerprint ?? "no-expectation";
  const path = recordPath(sessionId, fingerprint, taskId, phase);

  let capture: { digest: string; entries: unknown } | undefined;
  let failure: string | undefined;
  try {
    const projectDir = expectation?.projectDir ?? String(payload.cwd ?? ".");
    const { captureGitObservation } = await import("../workflows/lib/git-observation.ts");
    const observed = captureGitObservation(projectDir) as { digest: string };
    capture = { digest: observed.digest, entries: observed };
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (failure !== undefined) {
    writeRecord(path, { taskId, phase, status: "observation-failed", reason: failure, sessionId, fingerprint });
    // Fail OPEN on the dispatch, LOUD on the record. The gate will refuse the wave; we do not deny
    // the tool call on our own malfunction.
    if (phase === "pre") allow();
    context("PostToolUse", `Implement observation failed for task ${taskId}: ${failure}\nThis is a hook malfunction, NOT a task violation — the two are distinct outcomes. The implement gate will refuse this wave because the observation is missing.`);
  }

  writeRecord(path, { taskId, phase, status: "observed", digest: capture!.digest, observation: capture!.entries, sessionId, fingerprint });

  if (phase === "pre") allow();

  // ── Adjudication (post only) ───────────────────────────────────────────────
  const prePath = recordPath(sessionId, fingerprint, taskId, "pre");
  let pre: { status?: string; observation?: unknown } | undefined;
  try {
    pre = existsSync(prePath) ? JSON.parse(readFileSync(prePath, "utf8")) : undefined;
  } catch { pre = undefined; }

  if (!pre || pre.status !== "observed") {
    context("PostToolUse", `Task ${taskId} has no usable pre-dispatch observation, so its filesystem changes cannot be attributed. The implement gate will refuse this wave.`);
  }

  // Bounds come from the EXPECTATION, which the preflight derives from the authenticated plan —
  // never from the dispatch prompt. The prompt is composed by the orchestrator, and adjudicating a
  // task against bounds its own dispatcher supplied is not adjudication.
  const bounds = expectation?.tasks?.[taskId];
  if (!bounds) {
    context("PostToolUse", `Task ${taskId} was dispatched but is not in the authenticated expectation for this wave. The implement gate will refuse it: a task the plan does not name cannot be adjudicated.`);
  }

  // THREE OUTCOMES, AND THEY MUST NOT COLLAPSE INTO TWO.
  //
  // `enforceTaskOutputs` signals a violation by THROWING, and returns the expected output list on
  // success. So a naive `try { violations = enforce(...) } catch { hookMalfunction() }` gets it
  // exactly backwards twice over: a clean task looks violated (non-empty return), and a real
  // violation is reported as our own bug. The first smoke run did precisely that.
  //
  // So the two catches are separate on purpose. Anything that can fail because OUR machinery is
  // broken — loading the modules, comparing observations — is a malfunction and must never be
  // dressed up as a task violation. The adjudication call itself is the task's verdict, and its
  // throw is the finding, not an error.
  let delta: { changedPaths: string[] };
  let reported: unknown;
  try {
    const { compareGitObservations } = await import("../workflows/lib/git-observation.ts");
    delta = compareGitObservations(pre!.observation, capture!.entries) as { changedPaths: string[] };
    // The agent's own account of what it changed. enforceTaskOutputs cross-checks it against the
    // observed delta, which is how "the implementer misreported its own writes" gets caught — so
    // this value is deliberately taken from the agent and deliberately NOT trusted.
    const response = payload.tool_response as Record<string, unknown> | undefined;
    reported = response?.changedFiles ?? (response?.result as Record<string, unknown> | undefined)?.changedFiles;
  } catch (error) {
    writeRecord(recordPath(sessionId, fingerprint, taskId, "adjudication"), {
      taskId, status: "adjudication-failed", reason: error instanceof Error ? error.message : String(error),
    });
    context("PostToolUse", `Could not adjudicate task ${taskId} — the observation machinery failed. This is a hook malfunction, NOT a task violation; do not read it as the agent misbehaving. The implement gate will refuse this wave.`);
  }

  let violations: string[] = [];
  try {
    const { enforceTaskOutputs } = await import("../workflows/lib/task-contract.ts");
    enforceTaskOutputs(
      { id: taskId, writablePaths: bounds!.writablePaths, outputs: bounds!.outputs } as never,
      delta!.changedPaths,
      reported,
    );
  } catch (error) {
    violations = [error instanceof Error ? error.message : String(error)];
  }

  writeRecord(recordPath(sessionId, fingerprint, taskId, "adjudication"), {
    taskId, status: violations.length ? "violated" : "clean", violations, changedPaths: delta!.changedPaths,
  });

  if (violations.length) {
    // The enforcement, such as it is: the model never sees the agent's own success report. It cannot
    // proceed on a clean result it was never shown. The files are already written; that is not
    // recoverable here and the SKILL.md says so.
    console.log(pyJson({
      decision: "block",
      reason: `Task ${taskId} failed its output contract:\n${violations.map(v => `  - ${v}`).join("\n")}`,
      continue: false,
      stopReason: `IMPLEMENT halted: task ${taskId} failed adjudication against the authenticated plan.`,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: `TASK ${taskId} REJECTED — adjudication against the authenticated plan failed.\n${violations.map(v => `  - ${v}`).join("\n")}\nThis report REPLACES the agent's own result, which claimed success. The files it wrote are already on disk; this detects and refuses to accept the work, it does not undo it.`,
      },
    }));
    process.exit(0);
  }

  process.exit(0);
}
