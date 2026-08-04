#!/usr/bin/env bun
/**
 * Refuses plan mode for a session whose plans directory was only fixed AFTER the session started.
 *
 * THE DEFECT THIS CLOSES. Claude Code memoizes the resolved plans directory for the life of the
 * process and clears that cache only on a working-directory change, so `plansDirectory` written
 * mid-session does not reach that session: the plan still lands in `~/.claude/plans/<slug>.md`,
 * `bindApprovedGeneratedPlan` rejects it as not a child of `<root>/.planning`,
 * `approved-artifact-persist` defers, and the episode proceeds with no receipt — unauthenticated,
 * with every downstream gate reading an approval that was never recorded.
 *
 * WHY A GATE AND NOT THE WARNING IT REPLACES. `scripts/ensure-plans-directory.ts` first printed a
 * RESTART line and trusted whoever read it. Measured 2026-08-04: the reader answered *"Noted; I'll
 * handle that at the end"* and planned anyway, into `~/.claude/plans/goofy-brewing-gadget.md`. That
 * is not a comprehension failure — an advisory line is a suggestion, and a suggestion loses to the
 * task already in progress every time. The repo's own doctrine says a mechanically checkable red
 * flag becomes a hook; this is that hook.
 *
 * IT DENIES ENTRY, NOT JUST EXIT. Blocking only `ExitPlanMode` would let a session spend its whole
 * planning effort before discovering the plan cannot be bound. `EnterPlanMode` is where the refusal
 * costs least.
 *
 * IT IS INERT WITHOUT A MARKER, AND THAT IS THE INVARIANT. This is registered plugin-wide and runs
 * on every plan-mode call in every project of every user. The marker is written only by the entry
 * skills' preamble, only when it actually had to change something, and only keyed to the session
 * that ran it — so absence of a marker is an immediate silent allow, which is the overwhelmingly
 * common path. A session with no id cannot be the marked one and is likewise allowed.
 */
import { existsSync, readFileSync } from "node:fs";
import { allow, deny, denyOnCrash, readPayload } from "./_gate_common.ts";
import { restartMarkerPath } from "./lib/plans-restart-marker.ts";

denyOnCrash("plans-directory-restart-gate");

const payload = await readPayload();
if (payload.tool_name !== "EnterPlanMode" && payload.tool_name !== "ExitPlanMode") allow();

const sessionId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
if (!sessionId) allow();

const marker = restartMarkerPath(sessionId);
if (!existsSync(marker)) allow();

let settingsPath = "<project>/.claude/settings.json";
try {
  const parsed: unknown = JSON.parse(readFileSync(marker, "utf8"));
  if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).settingsPath === "string") {
    settingsPath = (parsed as Record<string, unknown>).settingsPath as string;
  }
} catch {
  // A corrupt marker still means a marker was written, and the condition it records — a plans
  // directory this process resolved before the setting existed — has not been undone by the
  // corruption. Deny with the generic path rather than falling through to allow.
}

deny(
  `🛑 This session resolved its plans directory before ${settingsPath} set plansDirectory, and Claude Code reads that value once per process. Planning now writes to ~/.claude/plans, where the generated plan cannot be bound to a receipt and the episode would run unauthenticated.\n\n` +
    "RESTART THIS SESSION, then re-enter the workflow. The restarted session picks up the setting and this gate goes quiet on its own — the marker is keyed to this session id and a new session has none.",
);
