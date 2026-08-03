#!/usr/bin/env bun
/**
 * Discharge an episode: the terminal of `clarify -> implement -> review`, and the only sanctioned way
 * to clear an outstanding transition debt.
 *
 * WHY THIS EXISTS AT ALL
 *   The moment transitions block, an abandoned episode becomes a WEDGE: stale phase state the Stop
 *   hook keeps enforcing, with no way to clear it. An enforcement design without a discharge
 *   condition does not fail safe, it fails stuck — and a stuck user reaches for `rm -rf .planning`,
 *   which turns every gate off at once. The escape hatch is what keeps the gates on.
 *
 * IT RECORDS, IT DOES NOT REFUSE
 *   Exit always succeeds. That is deliberate and it is the same philosophy as the quarantine list in
 *   `scripts/check-tests.sh`: you may skip, but the skip is itemized and named. An exit that could be
 *   refused wedges people; a SILENT exit defeats the gates. So the enforcement here is the audit
 *   trail — `{at, reason}` with reason one of `completed | abandoned | superseded` — and never a
 *   denial. `abandoned` with review owed is a legitimate, recorded outcome, not an error.
 *
 * ALWAYS REACHABLE
 *   This must work when the PreToolUse gate is denying and the Stop hook is blocking, or the recovery
 *   mechanism is unreachable exactly when it is needed. Two consequences: it is a plain script with
 *   no dependency on the gates it clears, and it writes `.planning/.state/` DIRECTLY rather than
 *   through a tool call — a restricted actor under `implementer-identity-gate` has no Bash and cannot
 *   write that directory, so an exit routed through the conversation's own tools would be denied in
 *   precisely the state that needs it. Whoever can run this script can exit.
 *
 * Usage:
 *   bun scripts/beat/episode-exit.ts --reason completed|abandoned|superseded [--project <dir>] [--json]
 */
import { existsSync } from "node:fs";
import { isGoverned } from "../../hooks/lib/governance-marker.ts";
import {
  episodeStatePath,
  readEpisodeState,
  writeEpisodeState,
  type EpisodeExit,
  type EpisodeState,
} from "../../hooks/lib/episode-state.ts";

export type ExitResult =
  | { ok: true; state: EpisodeState; reviewWasOwed: boolean }
  | { ok: false; reason: string };

const REASONS = new Set<EpisodeExit["reason"]>(["completed", "abandoned", "superseded"]);

export function exitEpisode(projectDir: string, reason: string, now: string): ExitResult {
  if (!REASONS.has(reason as EpisodeExit["reason"])) {
    return { ok: false, reason: `--reason must be one of completed, abandoned, superseded (got ${JSON.stringify(reason)})` };
  }
  if (!isGoverned(projectDir)) {
    return { ok: false, reason: "this project is not governed, so there is no episode to exit" };
  }
  const state = readEpisodeState(projectDir);
  if (state === null) {
    // Both cases are refusals, with DIFFERENT remedies, so they are not collapsed into one message.
    return existsSync(episodeStatePath(projectDir))
      ? { ok: false, reason: `${episodeStatePath(projectDir)} exists but does not parse; repair or delete it — exiting would overwrite state nobody can read` }
      : { ok: false, reason: "no episode is in flight" };
  }
  // EXITING AN ALREADY-EXITED EPISODE IS NOT AN ERROR, BUT IT DOES NOT REWRITE THE RECORD. The first
  // exit is the one that happened; a second call must not launder `abandoned` into `completed`.
  if (state.exit) return { ok: true, state, reviewWasOwed: false };

  const reviewWasOwed = state.reviewOwed;
  const exited: EpisodeState = {
    ...state,
    reviewOwed: false,
    reviewBlocks: 0,
    exit: { at: now, reason: reason as EpisodeExit["reason"] },
  };
  writeEpisodeState(projectDir, exited);
  return { ok: true, state: exited, reviewWasOwed };
}

if (import.meta.main) {
  const argv = process.argv;
  const at = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith("--") ? argv[index + 1] : undefined;
  };
  const result = exitEpisode(at("--project") ?? process.cwd(), at("--reason") ?? "", new Date().toISOString());
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`episode exit recorded: ${result.state.exit?.reason} at ${result.state.exit?.at}`);
    // Surfaced rather than swallowed: leaving with a review owed is permitted, and saying so is the
    // entire point of recording the reason instead of refusing the exit.
    if (result.reviewWasOwed) console.log("NOTE: a review was owed and is now discharged unreviewed. That is recorded in the episode's exit reason.");
  } else {
    console.error(`episode exit refused: ${result.reason}`);
  }
  if (!result.ok) process.exit(1);
}
