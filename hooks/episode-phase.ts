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
 * SCOPE. Built-in workflows no longer write a sentinel at all — this record replaces it, and the
 * Bash exemption that let the conversation write its own clarify proof is closed for them.
 * `external-fixed-v1` policies keep theirs: `clarifySentinel` is a REQUIRED field of the published
 * schemaVersion-1 descriptor, so removing it is a breaking change to a public extension surface.
 * The guard also still READS a built-in sentinel for one release, so a project mid-CLARIFY when it
 * upgrades is not re-locked; nothing writes one, so that path drains itself.
 *
 * IT NEVER RECORDS APPROVAL. `review.json.status` is the sole authority for that; see the invariant
 * in `hooks/lib/episode-state.ts`.
 */
import { existsSync } from "node:fs";
import { allow, readPayload } from "./_gate_common.ts";
import { governedRoot } from "./lib/governance-marker.ts";
import { workflowFromArg, workflowFromPlanningEvidence } from "./_workflow_policies.ts";
import { episodeStatePath, initEpisodeState, readEpisodeState, writeEpisodeState } from "./lib/episode-state.ts";

const payload = await readPayload();
if (payload.tool_name !== "AskUserQuestion") allow();

const start = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();

/**
 * TWO REGISTRATIONS, ONE HOOK — the same shape `approved-artifact-persist` uses.
 *
 * WITH `--workflow <name>`: the SKILL-scoped copy, wired by the workflows that also wire
 * `clarify-before-recon-guard`. Being inside `/dev` or `/ds` IS the signal, so it records regardless
 * of the governance marker. That is not a widening: those skills already wrote
 * `.planning/<X>_CLARIFIED.json` in exactly these projects, so `episode.json` is a SUBSTITUTION for
 * a file that was being written anyway — and it is written by a hook observing the real tool call
 * rather than by the model asserting about itself.
 *
 * WITHOUT it: the plugin-wide copy, marker-gated. This is the one that runs on every
 * `AskUserQuestion` in every project of every user, and it must stay inert without the marker.
 *
 * WHY THE SCOPES HAD TO MATCH. The guard is skill-scoped and fires everywhere; the recorder was
 * marker-gated and wrote nothing in unmarked projects. That mismatch is precisely why the sentinel
 * could not be retired — `clarified()` could never become true in an unmarked project, so `/dev` and
 * `/ds` would be permanently denied all reconnaissance there.
 */
/**
 * BOTH REGISTRATIONS MUST RESOLVE THE SAME ROOT, OR THEY WRITE TWO DIFFERENT EPISODES.
 *
 * They fire on the SAME `AskUserQuestion`. The skill-scoped copy first used the raw payload cwd
 * while the plugin-wide copy walked up, so in a governed project opened from a subdirectory each
 * wrote its own file — a nested `src/deep/.planning/.state/episode.json` carrying `dev` and a root
 * one carrying `work`. `approved-artifact-persist` resolves the ROOT, so it read the wrong workflow
 * and would bind a `/dev` plan as `work`. Measured. Found by the codex third-party adapter.
 *
 * `governedRoot(start) ?? start` keeps the skill-scoped copy working in an UNMARKED project (where
 * there is no root to find, and the session directory is the project) while making both copies agree
 * wherever a marker exists.
 */
const argWorkflow = workflowFromArg(Bun.argv.slice(2));
const resolved = governedRoot(start);
const cwd = argWorkflow ? (resolved ?? start) : resolved;
if (cwd === undefined) allow();

const existing = readEpisodeState(cwd);
// A state that exists but does not parse is NOT overwritten. Recreating it would silently discard a
// recorded phase or an outstanding review debt — the failure this whole design exists to prevent.
// Absence is different from corruption, and only absence is a reason to create.
if (existing === null && existsSync(episodeStatePath(cwd))) allow();

const sessionId = typeof payload.session_id === "string" && payload.session_id.trim() ? payload.session_id : null;
// The skill-scoped copy already knows which workflow it is; only the plugin-wide copy has to infer.
const workflow = argWorkflow?.workflow
  ?? existing?.workflow
  ?? workflowFromPlanningEvidence(cwd, null)?.workflow
  ?? "work";
const base = existing ?? initEpisodeState({ workflow, sessionId });

// FIRST ASK WINS FOR THE TIMESTAMP. A workflow may ask several times; the phase records when
// clarification BEGAN to be answered, and re-stamping it on every later question would make "when
// did CLARIFY complete" mean "the last time anyone asked anything".
//
// BUT THE WORKFLOW IDENTITY IS NOT FIRST-WINS — `--workflow` IS AUTHORITATIVE AND MUST STILL LAND.
// Both registrations fire on the same call and hook order is not guaranteed. When the plugin-wide
// copy ran first it INFERRED a workflow (now always `work`, since the sentinel it used to infer from
// is retired), stamped `clarified`, and this early return then let the skill-scoped copy — the one
// that actually KNOWS the workflow — exit without correcting it. A `/dev` episode recorded as
// `work`, at the project root, with no subdirectory involved. Measured; the codex adapter found the
// subdirectory half and this is the same defect reachable by ordering alone.
const identityIsWrong = argWorkflow !== null && base.workflow !== argWorkflow.workflow;
// THE ASKING SESSION IS RECORDED, NOT THE FIRST ONE EVER TO ASK.
//
// `clarify-before-recon-guard` requires `sessionId === payload.session_id` — deliberately, so a new
// session cannot inherit another's clarification. But reusing the stored session meant a SECOND
// session that genuinely asked the user was still measured against the FIRST one's id, failed the
// comparison, and was denied reconnaissance despite having done the thing the guard demands. The
// old sentinel had no such problem: each skill entry overwrote it with the current session. Found by
// the gemini third-party adapter; reproduced before fixing.
const sessionIsStale = sessionId !== null && base.sessionId !== sessionId;
if (base.phases.clarified && !identityIsWrong && !sessionIsStale) allow();

writeEpisodeState(cwd, {
  ...base,
  // The authoritative name when we have one; otherwise whatever was already recorded.
  workflow: argWorkflow?.workflow ?? base.workflow,
  sessionId: sessionId ?? base.sessionId,
  // FIRST ASK STILL WINS FOR THE TIMESTAMP. Correcting identity or session must not restate when
  // clarification began, or "when did CLARIFY complete" degrades to "the last time anyone asked".
  phases: { ...base.phases, clarified: base.phases.clarified ?? new Date().toISOString() },
});
allow();
