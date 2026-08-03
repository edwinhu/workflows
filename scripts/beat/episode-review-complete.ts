#!/usr/bin/env bun
/**
 * Discharge the review debt by RECORDING THAT THE REVIEW HAPPENED.
 *
 * WHY THIS EXISTS — IT WAS DOCUMENTED BEFORE IT WAS BUILT
 *   `beat-implement` and `beat-review` both state there are exactly two ways to clear the debt:
 *   complete the review, or record an exit. Only the second existed. Nothing anywhere wrote
 *   `phases.reviewed` or cleared `reviewOwed`, so a genuinely completed review left stale debt that
 *   kept blocking turns, and the only way out was `episode-exit.ts` — recording an ABANDONMENT for
 *   work that had actually been reviewed.
 *
 *   That is worse than having no gate. It teaches the user that the honest path does not work and
 *   the escape hatch does, and it corrupts the audit trail in the one direction that matters: a
 *   completed review filed as `abandoned`. Found by the codex third-party adapter reviewing the
 *   change that introduced the gap.
 *
 * WHY IT IS PLAN-BOUND
 *   A review discharges the debt for the plan it reviewed. Clearing it against a DIFFERENT plan
 *   would let a review of last week's work satisfy this week's obligation, which is the same class
 *   of error `matchesPlan` exists to prevent everywhere else.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not verify that a review happened. Nothing here can: the reviewer is a human or a
 *   dispatched agent, and its output is prose. This records a claim, exactly as `episode-exit.ts`
 *   records a reason. The gate's job is to make the claim EXPLICIT and auditable, not to adjudicate
 *   it — the same stance the exit path takes, for the same reason.
 *
 * Usage:
 *   bun scripts/beat/episode-review-complete.ts --decision ACCEPT|REJECT|CONTINUE \
 *       [--plan-file <basename> --plan-hash <sha256>] [--project <dir>] [--json]
 */
import { existsSync } from "node:fs";
import { isGoverned } from "../../hooks/lib/governance-marker.ts";
import {
  episodeStatePath,
  matchesPlan,
  readEpisodeState,
  writeEpisodeState,
  type EpisodeState,
} from "../../hooks/lib/episode-state.ts";

export type ReviewCompleteResult =
  | { ok: true; state: EpisodeState; decision: string }
  | { ok: false; reason: string };

const DECISIONS = new Set(["ACCEPT", "REJECT", "CONTINUE"]);

export function completeReview(
  projectDir: string,
  decision: string,
  now: string,
  plan?: { planFile: string; planHash: string },
): ReviewCompleteResult {
  if (!DECISIONS.has(decision)) {
    return { ok: false, reason: `--decision must be one of ACCEPT, REJECT, CONTINUE (got ${JSON.stringify(decision)})` };
  }
  if (!isGoverned(projectDir)) return { ok: false, reason: "this project is not governed, so there is no episode to review" };

  const state = readEpisodeState(projectDir);
  if (state === null) {
    return existsSync(episodeStatePath(projectDir))
      ? { ok: false, reason: `${episodeStatePath(projectDir)} exists but does not parse; repair or delete it — recording a review would overwrite state nobody can read` }
      : { ok: false, reason: "no episode is in flight" };
  }
  if (state.exit) return { ok: false, reason: `this episode already exited (${state.exit.reason} at ${state.exit.at}); reviewing it now would rewrite a closed record` };
  if (plan && !matchesPlan(state, plan.planFile, plan.planHash)) {
    return { ok: false, reason: "the supplied plan identity does not match the in-flight episode; a review discharges the debt only for the plan it reviewed" };
  }

  // A REJECT still discharges the DEBT. `beat-review` sends a rejection back to CLARIFY through a
  // newly approved plan, which is a new episode; leaving this one's debt outstanding would block the
  // turn that is trying to do exactly what the rejection asked for.
  const reviewed: EpisodeState = {
    ...state,
    reviewOwed: false,
    reviewBlocks: 0,
    phases: { ...state.phases, reviewed: now },
  };
  writeEpisodeState(projectDir, reviewed);
  return { ok: true, state: reviewed, decision };
}

if (import.meta.main) {
  const argv = process.argv;
  const at = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length && !argv[index + 1].startsWith("--") ? argv[index + 1] : undefined;
  };
  const planFile = at("--plan-file");
  const planHash = at("--plan-hash");
  const result = completeReview(
    at("--project") ?? process.cwd(),
    at("--decision") ?? "",
    new Date().toISOString(),
    planFile && planHash ? { planFile, planHash } : undefined,
  );
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`review recorded: ${result.decision} at ${result.state.phases.reviewed}; the review debt is discharged`);
  } else {
    console.error(`review not recorded: ${result.reason}`);
  }
  if (!result.ok) process.exit(1);
}
