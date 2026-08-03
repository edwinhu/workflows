#!/usr/bin/env bun
/**
 * Records completed beat phases into `.planning/.state/episode.json` from OBSERVED tool calls.
 *
 * WHY A HOOK RECORDS THIS AND THE CONVERSATION DOES NOT
 *   The existing clarify proof is `.planning/<X>_CLARIFIED.json`, and the model writes it about
 *   itself — `skills/ds/SKILL.md:67` has it `printf` its own `{"status":"clarified"}`, and
 *   `clarify-before-recon-guard.ts:44` carries a regex specifically permitting that Bash write. So
 *   the evidence that CLARIFY happened is the subject asserting it happened, and nothing stops the
 *   assertion being made without ever asking the user.
 *
 *   A `PostToolUse` on `AskUserQuestion` is DIRECT evidence: the tool ran, so the user was actually
 *   asked. It is not forgeable by the party being judged, because a hook is not a tool call and
 *   `.planning/.state/` is outside every conversation-level write surface
 *   (`implementer-identity-gate.ts:322-345`).
 *
 * SCOPE. This is the ADDITIVE half of the sentinel consolidation. The six sentinel files still exist
 * and `clarify-before-recon-guard` still reads them; retiring them touches 14 files including
 * `hasOnlyBenignPreplanSentinel`, and is deferred to its own reviewed change. Until then the two
 * records coexist and this one is the trustworthy one.
 *
 * INERT WITHOUT THE GOVERNANCE MARKER. This runs on every `AskUserQuestion` in every project of
 * every user. An unmarked project must see byte-for-byte today's behaviour: no file, no output.
 *
 * IT NEVER RECORDS APPROVAL. `review.json.status` is the sole authority for that; see the invariant
 * in `hooks/lib/episode-state.ts`.
 */
import { existsSync } from "node:fs";
import { allow, readPayload } from "./_gate_common.ts";
import { governedRoot } from "./lib/governance-marker.ts";
import { workflowFromPlanningEvidence } from "./_workflow_policies.ts";
import { episodeStatePath, initEpisodeState, readEpisodeState, writeEpisodeState } from "./lib/episode-state.ts";

const payload = await readPayload();
if (payload.tool_name !== "AskUserQuestion") allow();

const start = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();
// Resolved by walking up: a session working in a subdirectory must still record its phases.
const cwd = governedRoot(start);
if (cwd === undefined) allow();

const existing = readEpisodeState(cwd);
// A state that exists but does not parse is NOT overwritten. Recreating it would silently discard a
// recorded phase or an outstanding review debt — the failure this whole design exists to prevent.
// Absence is different from corruption, and only absence is a reason to create.
if (existing === null && existsSync(episodeStatePath(cwd))) allow();

const sessionId = typeof payload.session_id === "string" && payload.session_id.trim() ? payload.session_id : null;
const workflow = existing?.workflow
  ?? workflowFromPlanningEvidence(cwd, null)?.workflow
  ?? "work";
const base = existing ?? initEpisodeState({ workflow, sessionId });

// FIRST ASK WINS. A workflow may ask several times; the phase records when clarification BEGAN to be
// answered, and re-stamping it on every later question would make "when did CLARIFY complete" mean
// "the last time anyone asked anything".
if (base.phases.clarified) allow();

writeEpisodeState(cwd, {
  ...base,
  sessionId: base.sessionId ?? sessionId,
  phases: { ...base.phases, clarified: new Date().toISOString() },
});
allow();
