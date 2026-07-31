#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { bindApprovedGeneratedPlan, type BuiltInApprovalWorkflow } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg } from "./_workflow_policies.ts";

function fail(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(2); }
function defer(message: string): never { console.error(`[approved-artifact-persist] ${message}`); process.exit(1); }

const policy = workflowFromArg(Bun.argv.slice(2));
const nativeWorkflows = new Set<BuiltInApprovalWorkflow>(["ds", "dev", "work", "writing", "workshop", "workflow-creator"]);
if (!policy || policy.approvalPolicy !== undefined || !nativeWorkflows.has(policy.workflow as BuiltInApprovalWorkflow)) fail("requires a built-in native-plan workflow: ds, dev, work, writing, workshop, or workflow-creator; external descriptors have no native-plan producer");
let payload: Record<string, unknown>;
try { payload = JSON.parse(await Bun.stdin.text()); } catch { fail("hook payload is not valid JSON"); }
if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("hook payload must be an object");
if (payload.tool_name !== "ExitPlanMode") process.exit(0);
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
if (typeof payload.session_id !== "string" || !payload.session_id.trim()) fail("ExitPlanMode payload is missing a nonempty session_id");
try { bindApprovedGeneratedPlan(process.cwd(), policy.workflow as BuiltInApprovalWorkflow, approvedPath, payload.session_id); }
catch (error) { defer(`could not bind approved generated plan: ${error instanceof Error ? error.message : String(error)}`); }
