#!/usr/bin/env bun
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { hookActorIdentity, isSubagentPayload, parseApprovalPolicyDescriptor, validateApprovedArtifact, validateGeneratedPlanArtifact, type ApprovalPolicyDescriptor } from "../workflows/lib/approved-artifact.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, projectFromArgs, readPayload } from "./_gate_common.ts";
const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Approved artifact gate requires exactly one known --workflow ds|dev|work|writing|workshop|workflow-creator policy."); }
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
if (policy.approvalMode === "external-fixed-v1") {
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
  // The actor comes from the hook PAYLOAD. process.env.CLAUDE_SESSION_ID is never set in a real
  // hook process, so this argument was always `undefined` and every admission failed the identity
  // check; see hookActorIdentity. Both validators take the same actor, so the schema-v2
  // generated-plan-receipt-v1 route cannot reintroduce the env read on one branch only.
  //
  // ROLE. A conversation-level call (no agent_id) is DISPATCHING: the implementer it is about to
  // create does not exist yet, so holding it to approver != implementer would deny the normal
  // single-conversation flow outright. approver != implementer is enforced on the implementer's own
  // calls by implementer-identity-gate. A call from INSIDE a subagent already names a real actor,
  // so it carries the full three-way rule here.
  const identity = hookActorIdentity(payload);
  const actor = identity === null ? identity : { role: isSubagentPayload(payload) ? "implement" as const : "dispatch" as const, identity };
  result = policy.approvalMode === "generated-plan-receipt-v1"
    ? validateGeneratedPlanArtifact(projectDir, policy.workflow, actor)
    : validateApprovedArtifact(projectDir, policy.workflow, actor, approvalPolicy);
} catch (error) {
  deny(`APPROVED ARTIFACT GATE (${policy.workflow}): validation failed: ${error instanceof Error ? error.message : String(error)}.`);
}
if ("code" in result) deny(`APPROVED ARTIFACT GATE (${policy.workflow}): ${result.message}. Re-run independent review after validating the current plan.`);
allow();
