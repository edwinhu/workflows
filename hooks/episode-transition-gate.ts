#!/usr/bin/env bun
/**
 * Stop gate: a turn may not END with a transition owed.
 *
 * WHY THIS LEVER AND NOT AN INSTRUCTION
 *   A hook cannot invoke a skill. It can deny a tool call or inject text, and nothing else. So
 *   "IMPLEMENT finished, therefore go to REVIEW" is not expressible as routing — it is expressible
 *   only as *refusing to let the turn end while the debt stands*, and naming the legal moves. Without
 *   a blocking Stop, every other part of the transition design is advisory, and `implement -> review`
 *   stays what it is today in every workflow: prose.
 *
 * THIS IS THE REPO'S FIRST BLOCKING Stop HOOK, AND THE BLAST RADIUS IS THE WHOLE POINT OF THE GUARDS
 *   `hooks/session-end.ts` is emphatic that it "never blocks: stdout is always empty, exit is always
 *   0". Stop fires on every turn end in every project of every user, so a mistake here does not
 *   produce a bad denial — it produces a session that cannot finish. Four guards, in order:
 *
 *     1. UNGOVERNED IS A TOTAL NO-OP. No marker, no output, exit 0. This is the case that must never
 *        regress; it is every project that never opted in.
 *     2. AN UNREADABLE EPISODE DOES NOT BLOCK. Refusing to end a turn on state nobody can parse
 *        gives a user a wedged session and no way to diagnose it. Corruption is reported by the
 *        tools that read it, not enforced by refusing to stop.
 *     3. A BOUNDED COUNT. The gate refuses one debt at most `MAX_REVIEW_BLOCKS` times and then stands
 *        down permanently for it. This replaced an unconditional pass on `stop_hook_active`, which
 *        bounded the loop but reduced enforcement to a SINGLE prompt — a caller could simply stop on
 *        the second attempt. The codex third-party adapter caught that, and caught the docs claiming
 *        a hard gate. Its own proposed fix (block until discharged) is NOT adopted: a debt the model
 *        cannot discharge would become an inescapable session.
 *     4. A FAILED WRITE PASSES. The counter is what guarantees escape, so if it cannot be persisted
 *        the gate must not block — otherwise an unwritable `.planning/.state/` is an infinite loop.
 *        Fail toward letting the turn end, always.
 *
 * THE SECOND DEBT: A PLAN NOBODY BOUND
 *   `reviewOwed` is written in exactly one place — `implement-gate.ts:244` — i.e. only by the
 *   dispatch path. So the gate could notice work that went through the machinery and skipped a step,
 *   and could not notice work that never entered the machinery at all. The 2026-08-03 episode was
 *   the second kind: `ExitPlanMode` was rejected, the plan was hand-written into `.planning/`, no
 *   receipt was ever bound, and every gate keyed on a receipt was correctly inert.
 *
 *   This gate is the one lever that does not need to be armed by the thing it enforces: it fires at
 *   every turn end regardless of how the turn got there. `unboundGeneratedPlan` gives it something
 *   it can see from the filesystem alone. It refuses ONCE, then stands down permanently — see
 *   `MAX_PLAN_BINDING_BLOCKS`. The review debt keeps priority; one turn end raises one debt.
 *
 *   IT REACHES ONLY MARKED PROJECTS, AND THAT IS AN ACCEPTED LIMIT, NOT AN OVERSIGHT. Guard 1 exits
 *   on any project without `.claude-workflows.json`, so the incident project is not retroactively
 *   protected by this change. Adoption is offered by `beat-clarify` instead, which keeps the opt-in
 *   a user decision.
 *
 * THE DEBT IS ALWAYS DISCHARGEABLE
 *   Two legal moves, and the denial names both: complete the review, or record an exit with
 *   `scripts/beat/episode-exit.ts`. Exit always succeeds — including `--reason abandoned` while a
 *   review is owed — because an escape hatch that can be refused is a wedge, and the enforcement is
 *   the recorded reason rather than the refusal. A gate whose only exit is compliance is a gate
 *   people disable with `rm -rf .planning`, which turns off everything at once.
 */
import { readPayload } from "./_gate_common.ts";
import { governedRoot } from "./lib/governance-marker.ts";
import { MAX_PLAN_BINDING_BLOCKS, MAX_REVIEW_BLOCKS, readEpisodeState, writeEpisodeState } from "./lib/episode-state.ts";
import { unboundGeneratedPlan } from "./lib/unbound-plan.ts";

function pass(): never {
  process.exit(0);
}

/** The Stop contract's continue signal: `{"decision":"block","reason":...}` is fed back to the model. */
function block(reason: string): never {
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

let payload: Record<string, unknown>;
try {
  payload = await readPayload();
} catch {
  // A gate that cannot read its own input must not be the reason a session cannot end.
  pass();
}

const start = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();

// GUARD 1. The invariant: an unmarked project sees nothing. Resolved by walking up, so a session in
// a subdirectory is still governed — and so an unmarked project stays unmarked at every depth.
const cwd = governedRoot(start);
if (cwd === undefined) pass();

// GUARD 2. Absent and unreadable both pass; only a state we can actually read may block a turn.
//
// ABSENT PASSES FOR THE PLAN-BINDING DEBT TOO, AND THAT COSTS SOMETHING. With no episode there is
// nowhere to record a refusal, and an unrecorded refusal is an unbounded one — the infinite loop
// Guard 3/4 exist to prevent. Creating an episode here to hold the counter would mean this gate
// writes state into a project at turn end for a debt it only suspects, which is a worse trade in
// the one hook that runs at every turn end everywhere. The realistic path to a governed project
// with no episode is narrow: CLARIFY records one, and `beat-clarify` is where adoption is offered.
const state = readEpisodeState(cwd);
if (state === null) pass();
if (state.exit) pass();

// THE REVIEW DEBT, AND IT KEEPS PRIORITY. One turn end raises at most one debt: being told about a
// procedural step that was reached and skipped is more actionable than being told about a file
// shape, and stacking both would make the denial read as a wall rather than an instruction.
if (state.reviewOwed) {
  // GUARD 3. The budget for this debt is spent — stand down permanently rather than loop.
  if (state.reviewBlocks < MAX_REVIEW_BLOCKS) {
    // GUARD 4. Persist the refusal BEFORE issuing it. If this write fails the counter never
    // advances, so blocking anyway would refuse forever; an unwritable state directory must end the
    // turn, not trap it. `stop_hook_active` is deliberately NOT consulted — the counter is the bound
    // now, and reading both would spend the budget on a single turn's re-entries.
    try {
      writeEpisodeState(cwd, { ...state, reviewBlocks: state.reviewBlocks + 1 });
    } catch {
      pass();
    }

    const remaining = MAX_REVIEW_BLOCKS - (state.reviewBlocks + 1);
    block(
      `IMPLEMENT completed for this episode and a REVIEW is still owed, so this turn may not end yet.\n` +
      `\n` +
      `Two legal moves, and either one discharges it:\n` +
      `  1. Run the independent review for the approved plan, then record it.\n` +
      `  2. If this episode is finished or being dropped, record that instead:\n` +
      `       bun scripts/beat/episode-exit.ts --reason completed|abandoned|superseded\n` +
      `\n` +
      `Exit always succeeds — including "abandoned" with a review outstanding. The reason is recorded in ` +
      `the episode, which is the point: leaving is permitted, leaving silently is not.\n` +
      `\n` +
      (remaining > 0
        // Stated plainly so nobody mistakes a bounded gate for an inescapable one, and so a caller
        // that genuinely cannot discharge the debt knows the session will finish rather than
        // fighting it.
        ? `This gate will refuse ${remaining} more time(s) for this debt, then stand down permanently.`
        : `This was the last refusal for this debt; the gate will not block again for it.`),
    );
  }
  // The review budget is spent. Fall through: a spent budget silences THAT debt, not this hook.
}

// GUARD 5. THE PLAN NOBODY BOUND. Read from the filesystem, so it can see work that never entered
// the machinery — the one thing `reviewOwed` structurally cannot notice.
const unbound = unboundGeneratedPlan(cwd);
if (unbound === null) pass();
if (state.planBindingBlocks >= MAX_PLAN_BINDING_BLOCKS) pass();

// Same order as Guard 4, for the same reason: a refusal that cannot be recorded must not be issued.
try {
  writeEpisodeState(cwd, { ...state, planBindingBlocks: state.planBindingBlocks + 1 });
} catch {
  pass();
}

block(
  `.planning/${unbound} looks like an approved plan, but no receipt was ever written for it ` +
  `(.planning/.state/review.json is absent). The approval path writes both in one call, so this ` +
  `shape means the plan was hand-written rather than accepted through Plan mode — and every gate ` +
  `that keys on a receipt is inert for it: no delegated implementer, no verifier, no provenance.\n` +
  `\n` +
  `Two legal moves:\n` +
  `  1. Re-approve it through native Plan mode. Put the plan's content into the Plan-mode proposal ` +
  `and accept it; the receipt is written by the same call that accepts the plan.\n` +
  `  2. If this episode is finished or being dropped, record that instead:\n` +
  `       bun scripts/beat/episode-exit.ts --reason completed|abandoned|superseded\n` +
  `\n` +
  `If the file is not a plan at all — an old note, a scratch file — nothing needs doing. This gate ` +
  `refuses ONCE for it and will not block again.`,
);
