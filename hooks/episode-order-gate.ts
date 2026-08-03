#!/usr/bin/env bun
/**
 * PreToolUse: refuse to dispatch a NEW implementation wave while a REVIEW is owed for the last one.
 *
 * WHY THIS EXISTS, AND WHY IT WAS "IMPOSSIBLE" TWICE
 *   `implement -> review` was enforced only at TURN END, by the Stop gate, which refuses a bounded
 *   three times and then stands down. So the honest description of the machinery was: you may keep
 *   implementing forever, and the worst that happens is three prompts. Ordering was never enforced at
 *   the MOMENT of the out-of-order action.
 *
 *   That gap was closed as won't-fix twice, on the grounds that every available trigger was
 *   command-text matching — the undecidable classification this codebase spent eight documented
 *   rounds proving does not converge (`implementer-identity-gate.ts:31-50`). That reasoning was sound
 *   about SHELL COMMANDS and wrong here, because there is a trigger that is not text classification
 *   at all: the beat's own dispatch marker.
 *
 *   `preflight.ts` opens every implementation prompt with `TASK <id>: <name>` on its own line, and
 *   `work-implement-observation.ts` already correlates dispatches on exactly that marker. It is a
 *   signature THIS repo emits, not a string parsed out of user input, so recognising it is a lookup
 *   rather than a guess. If the marker is absent, this is not a beat implementation dispatch and the
 *   gate has nothing to say.
 *
 * WHAT IT DOES NOT BLOCK, WHICH IS WHY IT CANNOT WEDGE ANYONE
 *   - Dispatching the REVIEW itself. A reviewer prompt carries no `TASK <id>:` marker; only the
 *     beat's implementation prompts do.
 *   - Discharging the debt. Both routes are plain scripts run through Bash, untouched here.
 *   - Any project without `.claude-workflows.json`, which is the invariant that must never regress.
 *   - Any episode whose state cannot be read. Refusing on state nobody can parse gives a user a
 *     blocked dispatch and no way to diagnose it.
 *
 *   So the only thing refused is the specific act of starting MORE implementation while the previous
 *   wave is unreviewed — and the denial names both ways out.
 */
import { readPayload, allow, deny, denyOnCrash } from "./_gate_common.ts";
import { governedRoot } from "./lib/governance-marker.ts";
import { readEpisodeState } from "./lib/episode-state.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny rather than an exit-1,
// which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("EPISODE ORDER GATE");

const payload = await readPayload();
if (payload.tool_name !== "Agent") allow();

const input = (payload.tool_input as Record<string, unknown>) ?? {};
// The same expression `work-implement-observation.ts` correlates on, so the two cannot drift into
// disagreeing about what counts as an implementation dispatch.
if (!/^TASK ([^\n:]+):/m.test(String(input.prompt ?? ""))) allow();

const start = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();
const cwd = governedRoot(start);
if (cwd === undefined) allow();

const state = readEpisodeState(cwd);
if (state === null) allow();
if (state.exit) allow();
if (!state.reviewOwed) allow();

deny(
  `EPISODE ORDER GATE: a REVIEW is owed for the previous implementation wave, so a new one may not ` +
  `be dispatched yet.\n` +
  `\n` +
  `Discharge it first, either way:\n` +
  `  1. bun scripts/beat/episode-review-complete.ts --decision ACCEPT|REJECT|CONTINUE\n` +
  `  2. bun scripts/beat/episode-exit.ts --reason completed|abandoned|superseded\n` +
  `\n` +
  `Dispatching the review itself is NOT blocked — this refuses only prompts carrying the beat's ` +
  `\`TASK <id>:\` implementation marker. Recording an exit always succeeds, including ` +
  `"abandoned" with the review outstanding.`,
);
