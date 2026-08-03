#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bindApprovedGeneratedPlan, hookActorIdentity } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg, workflowFromPlanningEvidence } from "./_workflow_policies.ts";
import { governedRoot } from "./lib/governance-marker.ts";
import { readEpisodeState } from "./lib/episode-state.ts";

function fail(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(2); }
function defer(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(1); }

/**
 * TWO REGISTRATIONS, ONE HOOK.
 *
 * With `--workflow <name>` this is the skill-scoped copy that `/dev`, `/ds`, `/writing`, `/workshop`
 * and `/workflow-creator` wire in their frontmatter, unchanged.
 *
 * WITHOUT it, this is the PLUGIN-WIDE copy, and it exists because skill-scoped registration was the
 * whole defect: approving a plan outside a workflow skill persisted no receipt, so the project never
 * became governed and every plugin-wide gate stayed inert for the entire episode. Measured — an
 * episode planned, approved and implemented from main chat with no gate firing once.
 *
 * THE PLUGIN-WIDE COPY IS INERT WITHOUT THE GOVERNANCE MARKER, AND THAT IS THE INVARIANT THAT MUST
 * NEVER REGRESS. This hook now runs on every ExitPlanMode in every project of every user. An
 * unmarked project must see byte-for-byte today's behaviour: no receipt, no files, no output. The
 * marker check is therefore the first thing that happens on the no-arg path.
 */
const argPolicy = workflowFromArg(Bun.argv.slice(2));
if (Bun.argv.slice(2).length > 0 && !argPolicy) fail("requires a generated-plan approval workflow; external schema-v1 fixed-artifact descriptors have no native-plan producer");
if (argPolicy && argPolicy.approvalMode === "external-fixed-v1") fail("requires a generated-plan approval workflow; external schema-v1 fixed-artifact descriptors have no native-plan producer");
// THE PAYLOAD IS READ BEFORE ANY GOVERNANCE QUESTION IS ASKED, AND THE ORDER IS THE POINT.
// Resolving the project from `process.cwd()` meant that running from a subdirectory silently skipped
// persistence — measured, with `payload.cwd` correctly naming the project root and the hook ignoring
// it. A silent skip is the worst available shape: the episode looks governed to the user and is not.
// Found by the gemini third-party adapter; the first attempt at this fix reproduced the same
// ordering bug in reverse, by consulting the payload before parsing it.
let payload: Record<string, unknown>;
try { payload = JSON.parse(await Bun.stdin.text()); } catch { fail("hook payload is not valid JSON"); }
if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("hook payload must be an object");
if (payload.tool_name !== "ExitPlanMode") process.exit(0);

// Walked up from the session's directory, so a marker at the repository root governs work done
// anywhere inside it. `undefined` means ungoverned, which on the plugin-wide path is a silent no-op
// by design and on the skill-scoped path is irrelevant — that copy carries its own authority.
const start = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();
const resolvedRoot = governedRoot(start);
if (!argPolicy && resolvedRoot === undefined) process.exit(0);
const projectRoot = resolvedRoot ?? start;
const policy = argPolicy
  ?? workflowFromPlanningEvidence(projectRoot, readEpisodeState(projectRoot)?.workflow ?? null)
  ?? defer("cannot determine which workflow this episode belongs to: more than one clarify sentinel is present, and binding a plan to the wrong workflow identity is worse than binding none");
const transcriptPath = payload.transcript_path;
const toolUseId = payload.tool_use_id;
if (typeof transcriptPath !== "string" || typeof toolUseId !== "string" || !toolUseId) fail("ExitPlanMode transcript lookup identity is required; raw plan text cannot establish canonical file identity");
let approvedPath: unknown;
let resultCount = 0;
try {
  for (const line of readFileSync(transcriptPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(line); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue; record = parsed as Record<string, unknown>; } catch { continue; }
    const message = record.message as Record<string, unknown> | undefined;
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (!block || typeof block !== "object") continue;
      const result = block as Record<string, unknown>;
      if (result.type === "tool_result" && result.tool_use_id === toolUseId) {
        resultCount += 1;
        const toolUseResult = record.toolUseResult;
        approvedPath = toolUseResult && typeof toolUseResult === "object" && !Array.isArray(toolUseResult) ? (toolUseResult as Record<string, unknown>).filePath : undefined;
      }
    }
  }
} catch { defer("ExitPlanMode approved plan path could not be recovered from transcript"); }
if (resultCount > 1) fail("ExitPlanMode transcript contains duplicate matching records");
// PostToolUse can run before Claude has appended this result. Do not invalidate a
// completed ExitPlanMode call; the approval gate will remain closed until a retry binds it.
if (resultCount === 0) defer("ExitPlanMode matching transcript tool-result was not found");
if (typeof approvedPath !== "string" || !isAbsolute(approvedPath)) fail("ExitPlanMode toolUseResult.filePath must name the exact absolute generated plan path");
// Record the same composite actor identity the review and implementation gates compare against,
// so an approval taken in the conversation and one taken inside a subagent are distinguishable.
// With no agent_id this is exactly payload.session_id, so existing receipts stay valid.
//
// `policy.workflow` is passed unnarrowed: schema v2 admits external workflow identities, and
// bindApprovedGeneratedPlan validates it with isWorkflowIdentity rather than the built-in set.
const approvingActor = hookActorIdentity(payload);
if (approvingActor === null) fail("ExitPlanMode payload is missing a usable session_id");
try { bindApprovedGeneratedPlan(projectRoot, policy.workflow, approvedPath, approvingActor); }
catch (error) { defer(`could not bind approved generated plan: ${error instanceof Error ? error.message : String(error)}`); }
