#!/usr/bin/env bun
/** PostToolUse hook: suggest /writing-revise after a plan-bound edit threshold.
 *
 * The active writing identity is the APPROVED receipt-selected generated plan.
 *
 * THE COUNTER MOVED. It was `.planning/.state/writing.json` — a per-workflow state file with exactly
 * one consumer, this hook. It now lives in `editsSinceVerify` on the shared
 * `.planning/.state/episode.json`, because one consumer is not a reason for a file and that pattern
 * is how the planning directory reached eight state files across three classes. See
 * `.claude/CLAUDE.md` -> "State Files". Retired `ACTIVE_WORKFLOW.md` is conversion input only and is
 * never read or written.
 */
import { existsSync } from "node:fs";
import { context, readPayload } from "./_gate_common.ts";
import { authenticatedWritingPlan } from "./lib/writing-plan-context.ts";
import { episodeStatePath, initEpisodeState, matchesPlan, readEpisodeState, writeEpisodeState, type EpisodeState } from "./lib/episode-state.ts";

const DEFAULT_THRESHOLD = 10;

/**
 * The episode this edit belongs to, or `null` when the hook must not act.
 *
 * A MISSING state is created — an approved plan is authenticated by this point, so there is a real
 * episode to count against. A state bound to a DIFFERENT plan is not created over: the plan moved,
 * and resetting another episode's record to count edits would discard a recorded phase or a review
 * debt. That case returns null and the hook stays silent, which is the same fail-inert posture the
 * old `loadState` took on a malformed file.
 */
function episodeFor(projectRoot: string, workflow: string, planFile: string, planHash: string, sessionId: string | null): EpisodeState | null {
  const existing = readEpisodeState(projectRoot);
  if (existing === null) {
    // ABSENT AND UNREADABLE BOTH COME BACK AS `null`, AND CONFLATING THEM DESTROYS STATE.
    // Creating a fresh episode over a file we could not parse overwrites recorded phases and any
    // outstanding review debt — silently discharging a review nobody performed. The paragraph above
    // has always claimed this guard; for one evening it did not implement it, while the identical
    // guard was written correctly in `episode-phase.ts` and `implement-gate.ts`. Found by the gemini
    // third-party adapter reviewing this very change; codex reviewed the same diff and missed it.
    if (existsSync(episodeStatePath(projectRoot))) return null;
    return initEpisodeState({ workflow, sessionId, planFile, planHash });
  }
  if (!matchesPlan(existing, planFile, planHash)) return null;
  // A pre-plan episode gets its binding filled in the first time an approved plan is seen, and a
  // null session is backfilled the first time a writer HAS one. Leaving sessionId null forever meant
  // `clarify-before-recon-guard` could never match it and silently fell back to the sentinel — the
  // trustworthy evidence path quietly switching itself off. Found by the gemini adapter.
  return {
    ...existing,
    ...(existing.planHash === null ? { planFile, planHash } : {}),
    ...(existing.sessionId === null && sessionId !== null ? { sessionId } : {}),
  };
}

async function main(): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = await readPayload();
  } catch {
    return;
  }
  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") return;
  const filePath = (payload.tool_input as Record<string, unknown> | undefined)?.file_path;
  if (typeof filePath !== "string" || !filePath.endsWith(".md")) return;

  const plan = authenticatedWritingPlan(filePath);
  if (!plan) return;
  // No session in this payload is normal, not a failure — the episode records it as null and a
  // later session-bound writer fills it. Refusing here would silently stop counting edits.
  const sessionId = typeof payload.session_id === "string" && payload.session_id.trim() ? payload.session_id : null;
  // A malformed, tampered, or stale state must not be overwritten by a hook.
  const state = episodeFor(plan.projectRoot, "writing", plan.plan.planFile, plan.plan.hash, sessionId);
  if (!state) return;

  const edits = state.editsSinceVerify + 1;
  if (edits < DEFAULT_THRESHOLD) {
    writeEpisodeState(plan.projectRoot, { ...state, editsSinceVerify: edits });
    return;
  }
  writeEpisodeState(plan.projectRoot, { ...state, editsSinceVerify: 0 });
  context(
    "PostToolUse",
    `📝 ${edits} edits since last verify (style: ${plan.style || "general"}, phase: edit). ` +
      "Consider `/writing-revise` to apply fixes and polish.",
  );
}

await main();
