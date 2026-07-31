#!/usr/bin/env bun
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { parseApprovalPolicyDescriptor, validateApprovedArtifact, type ApprovalPolicyDescriptor } from "../workflows/lib/approved-artifact.ts";
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
const projectDir = projectFromArgs(input, payload);
let approvalPolicy: ApprovalPolicyDescriptor | undefined;
if (policy.approvalPolicy !== undefined) {
  try {
    const root = realpathSync(projectDir);
    const path = join(root, policy.approvalPolicy);
    const fromRoot = relative(root, path);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) throw new Error("path escapes project");
    let component = root;
    for (const segment of fromRoot.split(/[\\/]/)) {
      component = join(component, segment);
      if (lstatSync(component).isSymbolicLink()) throw new Error("approval policy path contains a symbolic link");
    }
    if (!lstatSync(path).isFile()) throw new Error("not a regular file");
    const canonical = realpathSync(path);
    const canonicalFromRoot = relative(root, canonical);
    if (!canonicalFromRoot || canonicalFromRoot === ".." || canonicalFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(canonicalFromRoot)) throw new Error("path escapes project");
    const content = readFileSync(path, "utf8");
    const parsed = parseApprovalPolicyDescriptor(JSON.parse(content), policy.workflow);
    if ("code" in parsed) deny(`APPROVED ARTIFACT GATE (${policy.workflow}): ${parsed.message}.`);
    approvalPolicy = parsed;
  } catch (error) {
    deny(`APPROVED ARTIFACT GATE (${policy.workflow}): cannot load explicit approval policy: ${error instanceof Error ? error.message : String(error)}.`);
  }
}
let result;
try {
  result = validateApprovedArtifact(projectDir, policy.workflow, process.env.CLAUDE_SESSION_ID, approvalPolicy);
} catch (error) {
  deny(`APPROVED ARTIFACT GATE (${policy.workflow}): validation failed: ${error instanceof Error ? error.message : String(error)}.`);
}
if ("code" in result) deny(`APPROVED ARTIFACT GATE (${policy.workflow}): ${result.message}. Re-run independent review after validating the current plan.`);
allow();
