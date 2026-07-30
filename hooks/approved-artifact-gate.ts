#!/usr/bin/env bun
import { validateApprovedArtifact } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, projectFromArgs, readPayload } from "./_gate_common.ts";
const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Approved artifact gate requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy."); }
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
if (tool !== "Agent" && tool !== "Workflow") allow();
const input = (payload.tool_input as Record<string, unknown>) ?? {};
// Pre-approval dispatch is limited to explicitly read-only reviewers. Generic Agent and every
// Workflow remain implementation-capable and require the exact approved-plan lifecycle.
if (tool === "Agent" && ["Explore", "workflows:librarian", "workflows:plan-checker", "workflows:code-reviewer"].includes(String(input.subagent_type ?? ""))) allow();
if (tool === "Workflow" && policy.workflow === "workflow-creator" && String(input.name ?? "") === "wc-audit") {
  let args = input.args;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = null; } }
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const audit = args as Record<string, unknown>;
    const keys = Object.keys(audit);
    const allowedKeys = new Set(["auditOnly", "readOnly", "targetWorkflow", "projectDir", "pluginRoot", "rubricPath", "workflowsRepo", "targetFiles", "phases", "mechanicalProbes", "criteriaRows", "enforcementChecklistPath", "migrationPlaybookPath", "threshold", "onlyChecks", "priorReviews"]);
    if (audit.auditOnly === true && audit.readOnly === true && Array.isArray(audit.targetFiles) && Array.isArray(audit.mechanicalProbes) && audit.mechanicalProbes.length === 0 && Array.isArray(audit.criteriaRows) && keys.every(key => allowedKeys.has(key))) allow();
  }
}
const result = validateApprovedArtifact(projectFromArgs(input, payload), policy.workflow, process.env.CLAUDE_SESSION_ID);
if ("code" in result) deny(`APPROVED ARTIFACT GATE (${policy.workflow}): ${result.message}. Re-run independent review after validating the current plan.`);
allow();
