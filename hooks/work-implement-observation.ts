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
 * THE GATE IS scripts/beat/implement-gate.ts, AND IT IS LOAD-BEARING. It did not exist when this
 * header was written, and this hook was registered in NOTHING until v5.106.1 — so for one release the
 * expectation file was written and never read, every dispatch went unadjudicated, and 35 passing
 * behaviour tests here said the hook was correct. Behaviour and registration are separate properties;
 * tests/observation-hook-registration.test.py now holds the second one.
 *
 * IF THE GATE IS EVER WEAKENED TO A WARNING, THIS WHOLE DESIGN GOES UNDERWATER
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
 * INTENDED PROPERTY, NOT AN ACCIDENT: an agent whose reported changedFiles disagree with the
 * observed delta is caught here too — enforceTaskOutputs cross-checks the two. That is the
 * self-vouching failure this whole redesign exists to remove, so do not delete it as redundant with
 * the bounds check: a bounds check catches writing the WRONG file, this catches LYING about which
 * file was written.
 *
 * Usage: --phase pre|post --workflow <ds|dev|work>
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { sessionFlagKey, allow, context, pyJson } from "./_gate_common.ts";

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
  // Everything up to the first colon on the line, NOT `\S+`. Task ids are opaque strings in the
  // shared task contract, and real ones contain spaces: /writing keys its tasks by section name, so
  // `TASK Part I: draft section` is an ordinary dispatch. Under `\S+` that line does not match AT
  // ALL — the regex needs a colon immediately after the token — so the hook classified it as a
  // non-implement call and left it entirely alone. Silent, complete loss of adjudication for exactly
  // the workflow being onboarded.
  const match = /^TASK ([^\n:]+):/m.exec(String(prompt ?? ""));
  return match?.[1].trim() || undefined;
}

/**
 * The task id this dispatch is FOR, resolved against the ids the authenticated plan actually names.
 *
 * `taskIdFrom` cannot be exact, and no regex can be. The marker is `TASK <id>: <name>` and both parts
 * are free text, so `TASK Part I: Foundations` is ambiguous on its face — a task called "Part I" whose
 * name is "Foundations", or one called "Part I: Foundations". /writing keys its tasks by SECTION NAME,
 * and a colon in an academic section title is ordinary, so this is a real input rather than a
 * contrived one: it parsed to "Part I", matched no bounds, and the task went unadjudicated.
 *
 * The ambiguity dissolves once you stop guessing. The expectation already lists every legitimate id
 * for this wave, so the prompt is matched AGAINST that list instead of parsed in isolation. Longest
 * match wins, so an id that is a prefix of another ("Part I" alongside "Part I: Foundations") resolves
 * to the specific one. Only when there is no expectation at all — a dispatch with no preflight — does
 * it fall back to the loose parse, which is right: that path exists to RECORD an unexpected dispatch,
 * not to adjudicate it.
 */
export function resolveTaskId(prompt: unknown, expectation?: Expectation): string | undefined {
  const loose = taskIdFrom(prompt);
  if (!loose || !expectation?.tasks) return loose;
  const text = String(prompt ?? "");
  const known = Object.keys(expectation.tasks)
    .filter(id => new RegExp(`^TASK ${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m").test(text))
    .sort((a, b) => b.length - a.length);
  return known[0] ?? loose;
}

export type Expectation = {
  waveFingerprint: string;
  projectDir: string;
  workflow: string;
  /**
   * taskId -> the bounds adjudication is judged against. DERIVED from the authenticated plan.
   *
   * `redCommand`, when present, is executed by this hook on BOTH sides of the dispatch: it must fail
   * before the task runs and pass after. That is the only way "valid RED" becomes a fact rather than
   * a claim — an agent asked to report its own RED step can simply say it happened.
   */
  tasks: Record<string, { writablePaths: string[]; outputs: string[]; redCommand?: string }>;
};

/**
 * Run a task's `redCommand` and report what the SHELL said, not what anyone claims it said.
 *
 * Bounded on purpose: a 10-minute ceiling and a truncated tail. The hooks.json entries carry
 * `timeout: 660` for the same reason — Claude Code's DEFAULT hook timeout is 60s, so without it the
 * runtime would kill this process mid-probe, before `writeRecord` ever runs. No record would exist,
 * and the gate would refuse the wave as `missing-pre`/`missing-post` — reporting "the hook did not
 * run" for a hook that ran fine and was cut off. Any change to the ceiling below must move with it. A test command that hangs must not
 * wedge every dispatch behind it, and a runaway log must not be copied wholesale into a record file
 * that the gate later parses. A timeout is NOT read as failure-therefore-valid-RED — it is its own
 * outcome, because "the suite never finished" tells you nothing about whether the behaviour is absent.
 */
export function runRedCommand(command: string, projectDir: string): { exitCode: number | null; timedOut: boolean; tail: string; error?: string } {
  try {
    // `bash -c`, NOT `-lc`. A login shell sources the user's profile, so the verdict would depend on
    // startup files and a mutable PATH — an agent-created binary earlier on PATH could decide RED or
    // GREEN, and profile code would execute on every probe. Nothing about running a test needs a
    // login shell.
    const proc = Bun.spawnSync(["bash", "-c", command], { cwd: projectDir, stdout: "pipe", stderr: "pipe", timeout: 600_000 });
    const text = `${new TextDecoder().decode(proc.stdout ?? new Uint8Array())}${new TextDecoder().decode(proc.stderr ?? new Uint8Array())}`;
    // `signalCode` is set when the timeout killed it; exitCode alone cannot distinguish that from
    // an ordinary nonzero exit, and conflating them would let a hung suite masquerade as a valid RED.
    const timedOut = proc.signalCode === "SIGTERM" || proc.signalCode === "SIGKILL";
    return { exitCode: proc.exitCode, timedOut, tail: text.slice(-4000) };
  } catch (error) {
    return { exitCode: null, timedOut: false, tail: "", error: error instanceof Error ? error.message : String(error) };
  }
}

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
  // THE TASK ID IS HASHED, NOT SANITIZED. Sanitizing is lossy and the loss is a collision:
  // `a/b`, `a?b` and `a b` all became `a_b` and shared one evidence file, and any two ids agreeing on
  // their first 96 sanitized characters shared one too. Task ids are opaque strings in the shared
  // contract — /writing keys them by section name — so both shapes are reachable, and the effect is
  // that one task's clean record can satisfy the gate for a different task.
  //
  // This is the mirror of the marker-parsing bug: careful colon-handling at the prompt layer is
  // worthless if identity is destroyed at the storage layer. A readable prefix is kept for humans;
  // the digest is what makes the filename injective.
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  const injective = (value: string) =>
    `${value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40)}-${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`;
  return join(OBSERVATION_DIR, `${safe(sessionId)}--${safe(fingerprint)}--${injective(taskId)}--${phase}.json`);
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
/**
 * Drop records older than the retention window.
 *
 * Nothing ever pruned this directory. Measured on a working machine: 2,375 files, growing by four
 * per task forever, in a world-readable temp directory — each one carrying a project path, a task
 * id, and a changed-file inventory. That is a slow leak of both disk and information, and it also
 * makes the gate's directory scan for unexpected dispatches linear in the lifetime of the machine
 * rather than in the size of the wave.
 *
 * Deliberately time-based rather than count-based: the gate reads records written moments earlier by
 * the paired hook, so a count cap could evict a LIVE wave's pre-observation and turn a clean run into
 * `missing-pre`. A window comfortably longer than any dispatch cannot. Failure to prune is never an
 * error — this is hygiene, and a hook that broke a run over housekeeping would be a worse bug than
 * the leak.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export function pruneObservations(now: number = Date.now()): number {
  let removed = 0;
  try {
    for (const entry of readdirSync(OBSERVATION_DIR)) {
      const path = join(OBSERVATION_DIR, entry);
      try {
        if (now - statSync(path).mtimeMs > RETENTION_MS) { rmSync(path, { force: true }); removed++; }
      } catch { /* a file that vanished under us needs no pruning */ }
    }
  } catch { /* no directory yet, or unreadable: nothing to prune */ }
  return removed;
}

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

  // PARSED LOCALLY, NOT VIA `parsePayload`. That helper's `requireObject` calls `process.exit(1)`
  // outright on a non-object payload — deliberately, so "no local catch can intercept it" — because
  // it is built for GATES, which must deny when they cannot decide. This hook is not a gate: it
  // observes, and a non-zero PreToolUse exit is a silent allow. Measured: payloads `null`, `[]` and
  // `"str"` all exited 1 here, which `tests/pretooluse-crash-closure.test.mjs` catches by actually
  // RUNNING each wired hook against hostile input — stronger than this hook's own suite, which only
  // tried unparseable bytes and never valid-JSON-of-the-wrong-type.
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload is not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    // A malformed payload tells us nothing about which task this was, so there is no record to key.
    // Never deny on it.
    if (phase === "pre") allow();
    process.exit(0);
  }

  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const looseTaskId = taskIdFrom(toolInput.prompt);
  // Not an implement dispatch. Silence is how a PostToolUse hook says "carry on" — an explicit
  // {"decision":"allow"} is REJECTED as invalid and discards the whole payload, which would turn a
  // pass into a deny. See ds-post-subagent-guard.
  if (!looseTaskId) {
    if (phase === "pre") allow();
    process.exit(0);
  }

  const sessionId = sessionFlagKey(payload);
  const expectation = loadExpectation(sessionId);
  // Re-resolve against the ids the plan actually names. The loose parse above only answered "is this
  // an implement dispatch at all"; it cannot answer WHICH task when an id contains a colon.
  const taskId = resolveTaskId(toolInput.prompt, expectation) ?? looseTaskId;
  // No expectation means the preflight did not run. We still record, keyed so the gate can tell this
  // apart from a swept record: "never expected" and "expected but unobserved" have different causes
  // and different remedies, and collapsing them sends someone hunting a stale record when their real
  // problem is a missing preflight.
  const fingerprint = expectation?.waveFingerprint ?? "no-expectation";
  const path = recordPath(sessionId, fingerprint, taskId, phase);

  // ORDER IS LOAD-BEARING, AND IT DIFFERS BY PHASE.
  //
  // The red probe RUNS A TEST SUITE, and test suites litter: .pytest_cache/, __pycache__/, coverage
  // files, compiled fixtures. Whatever it creates must land OUTSIDE the pre→post window, or
  // enforceTaskOutputs sees those paths in the delta, finds them outside the task's writablePaths,
  // and blocks an agent that did exactly what it was told.
  //
  //   pre:  probe FIRST, then capture  — the probe's litter is part of the baseline
  //   post: capture FIRST, then probe  — the probe's litter lands after the measured window
  //
  // Getting this wrong is not a subtle degradation: it fails clean runs, and it blames the agent.
  const declaredRed = expectation?.tasks?.[taskId]?.redCommand;
  const probeDir = expectation?.projectDir ?? String(payload.cwd ?? ".");
  const runProbe = () => declaredRed ? { command: declaredRed, ...runRedCommand(declaredRed, probeDir) } : undefined;
  // WIRED, NOT MERELY DEFINED. An unreferenced helper is the exact defect
  // scripts/wc/executable-position.ts exists to catch, and writing one here while fixing a leak
  // would be the class inside the fix for the class. Pre-phase only: once per dispatch, before any
  // of this wave's own records exist, so it can never evict them.
  pruneObservations();

  let redProbe = phase === "pre" ? runProbe() : undefined;
  let probeMutated: string | undefined;

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

  // THE GREEN HALF. Executed here rather than in the emitted script or the agent prompt because this
  // is the only place that sits OUTSIDE the party being judged: the hook fires around the dispatch,
  // and the command comes from the authenticated expectation, which the agent never sees and cannot
  // edit. Runs after the post capture — see the ordering note above.
  if (phase === "post") {
    redProbe = runProbe();
    // THE PROBE RUNS AFTER THE POST CAPTURE, so anything it writes is invisible to adjudication.
    // An adversarial review turned that into an exploit: a command that mutates a declared output
    // after the capture leaves the gate adjudicating bytes that are no longer on disk. Command shape
    // is now constrained so it cannot redirect, but a test runner can still write through code it
    // loads — so verify rather than assume, and treat a post-probe mutation as a violation of its own.
    try {
      const { captureGitObservation } = await import("../workflows/lib/git-observation.ts");
      const after = captureGitObservation(expectation?.projectDir ?? String(payload.cwd ?? ".")) as { digest: string };
      if (after.digest !== capture!.digest) {
        probeMutated = "the redCommand modified the working tree AFTER the post-dispatch observation, so what was adjudicated is not what remains on disk";
      }
    } catch {
      // A failure to re-observe is our malfunction, not the task's. The existing record already
      // stands; do not manufacture a violation out of our own error.
    }
  }

  writeRecord(path, { taskId, phase, status: "observed", digest: capture!.digest, observation: capture!.entries, sessionId, fingerprint, ...(redProbe ? { redProbe } : {}) });

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

  // `enforceTaskOutputs` throws for FOUR different causes, and only ONE of them is the agent:
  //
  //   task-contract.ts:89  "task writable authority is invalid"           <- the task contract is malformed
  //   task-contract.ts:91  "expected output is outside writable authority" <- the PLAN declares a bad output
  //   task-contract.ts:93  malformed observed paths                        <- OUR delta is broken
  //   task-contract.ts:95+ "observed output is outside writable authority" <- the AGENT violated
  //
  // Flattening all four into `violations` blames the implementer for a malformed plan and for our own
  // machinery bugs, and halts the run with `continue: false` in both cases. That is this design's
  // recurring failure — distinct causes with distinct remedies collapsed into one channel — one layer
  // below where I had already fixed it.
  //
  // The separation is STRUCTURAL, not message-matching: matching throw text breaks the first time
  // someone rewords it. Instead the other three causes are made UNREACHABLE before enforce runs, so
  // whatever survives to the catch is necessarily the agent.
  let violations: string[] = [];
  try {
    const { concretePaths, pathsOverlap } = await import("../workflows/lib/task-contract.ts");
    // Causes 1 and 2: properties of the PLAN, true before any agent ran and unavoidable by good
    // behaviour. The preflight validates these for the whole wave before dispatching anything, which
    // is both earlier and the right place; this is defence in depth for a hook that outlives it.
    const writable = concretePaths(bounds!.writablePaths);
    if (!writable) throw new Error(`task ${taskId} declares invalid writable authority`);
    for (const output of bounds!.outputs) {
      if (![...writable].some(allowed => pathsOverlap(output, allowed))) {
        throw new Error(`plan declares output "${output}" outside task ${taskId}'s writable authority`);
      }
    }
    // Cause 3: our own delta. Belongs to the machinery channel, never to the agent's.
    if (!Array.isArray(delta!.changedPaths) || delta!.changedPaths.some(p => typeof p !== "string" || !p)) {
      throw new Error(`observed delta for task ${taskId} is malformed`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeRecord(recordPath(sessionId, fingerprint, taskId, "adjudication"), {
      taskId, status: "not-adjudicable", reason,
    });
    context("PostToolUse", `Task ${taskId} could not be adjudicated: ${reason}\nThis is a PLAN or MACHINERY defect, NOT a task violation — the agent could not have avoided it by behaving correctly, and it would be true if no agent had run. The implement gate will refuse this wave; fix the plan or the observation, do not re-dispatch the agent.`);
  }

  try {
    const { enforceTaskOutputs } = await import("../workflows/lib/task-contract.ts");
    enforceTaskOutputs(
      { id: taskId, writablePaths: bounds!.writablePaths, outputs: bounds!.outputs } as never,
      delta!.changedPaths,
      reported,
    );
  } catch (error) {
    // Everything that could throw here for a non-agent reason has been ruled out above, so this is
    // the finding: the agent wrote outside its authority, failed to produce a declared output,
    // produced an undeclared one, or misreported its own changes.
    violations = [error instanceof Error ? error.message : String(error)];
  }

  // RED/GREEN IS ADJUDICATED **HERE**, NOT ONLY IN THE GATE.
  //
  // `scripts/beat/implement-gate.ts` computes the same verdict, and an adversarial review pointed out
  // that nothing at runtime invokes it: its only caller is a bash line in a SKILL.md, so an
  // orchestrator that simply never runs the CLI faces no RED/GREEN enforcement at all. The headline
  // claim of this feature — that valid RED is executed rather than reported — was resting on a gate
  // reached by prose, which is the exact defect class this whole line of work exists to remove.
  //
  // So the hook, which the runtime DOES invoke, blocks on it directly. The gate keeps its copy for
  // wave-level adjudication and post-hoc audit; neither now depends on the other being run.
  if (bounds?.redCommand) {
    const preProbe = (pre as { redProbe?: Record<string, unknown> } | undefined)?.redProbe;
    const unusable = (probe: Record<string, unknown> | undefined, side: string): string | undefined => {
      if (!probe) return `the ${side}-dispatch observation carries no redProbe; the declared redCommand was never executed`;
      if (probe.command !== bounds.redCommand) return `the ${side}-dispatch redProbe ran a different command than the plan declares`;
      if (probe.error) return `the ${side}-dispatch redCommand could not be executed: ${String(probe.error)}`;
      if (probe.timedOut) return `the ${side}-dispatch redCommand timed out; a suite that never finished proves nothing either way`;
      if (typeof probe.exitCode !== "number") return `the ${side}-dispatch redCommand produced no exit status`;
      return undefined;
    };
    const problem = unusable(preProbe, "pre") ?? unusable(redProbe as Record<string, unknown> | undefined, "post");
    if (problem) violations.push(problem);
    else if ((preProbe as { exitCode: number }).exitCode === 0) {
      violations.push(`redCommand PASSED before implementation (exit 0), so it does not pin the behaviour this task builds: ${bounds.redCommand}`);
    } else if ((redProbe as unknown as { exitCode: number }).exitCode !== 0) {
      violations.push(`redCommand still fails after implementation: ${bounds.redCommand}`);
    }
  }
  if (probeMutated) violations.push(probeMutated);

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
