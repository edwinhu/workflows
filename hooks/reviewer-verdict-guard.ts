#!/usr/bin/env bun
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseApprovalPolicyDescriptor, parseReviewState, parseVerdict, resolveGeneratedPlanReviewState, sha256, validateApprovedPlan } from "../workflows/lib/approved-artifact.ts";
import { safeExactTarget, safeProjectPath, hasUnsafeCompoundCommand } from "./_path_safety.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, readPayload } from "./_gate_common.ts";

const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) deny("Reviewer verdict guard requires exactly one known workflow policy.");
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
const reason = "Reviewer read-only enforcement: return findings without modifying artifacts, state, or project files.";
if (tool === "Edit") deny(reason);

const generatedPlan = policy.approvalMode !== "external-fixed-v1";
const receiptPath = join(cwd, ".planning", ".state", "review.json");
let selectedPlan = join(cwd, ".planning", "PLAN.md");
let externalVerdictPath: string | null = null;
let externalApproval: { approvedSession: string; approvedAt: string } | null = null;
let pending: ReturnType<typeof parseReviewState> | null = null;
let validatedPlanHash: string | null = null;
if ((tool === "Write" || tool === "Bash") && generatedPlan) {
  try { pending = parseReviewState(readFileSync(receiptPath, "utf8"), policy.workflow); }
  catch { pending = null; }
  if (!pending || "code" in pending || pending.status !== "PENDING") deny("Reviewer requires the current PENDING combined review.json created by native Plan approval.");
  selectedPlan = join(cwd, ".planning", pending.plan_file);
} else if ((tool === "Write" || tool === "Bash") && policy.approvalMode === "external-fixed-v1") {
  try {
    const approvalPolicyPath = safeProjectPath(cwd, policy.approvalPolicy);
    if (!approvalPolicyPath || !safeExactTarget(cwd, approvalPolicyPath, join(cwd, policy.approvalPolicy))) deny("Reviewer cannot resolve the external schema-v1 approval policy safely.");
    const descriptor = parseApprovalPolicyDescriptor(JSON.parse(readFileSync(approvalPolicyPath, "utf8")), policy.workflow);
    if ("code" in descriptor) deny(descriptor.message);
    if (policy.reviewerVerdict !== descriptor.verdictPath) deny("External reviewer verdict path must exactly match the approval descriptor verdictPath.");
    const policyVerdictPath = safeProjectPath(cwd, policy.reviewerVerdict);
    const descriptorVerdictPath = safeProjectPath(cwd, descriptor.verdictPath);
    if (!policyVerdictPath || !descriptorVerdictPath || !safeExactTarget(cwd, descriptorVerdictPath, policyVerdictPath)) deny("External reviewer verdict path is not a canonical symlink-safe project target.");
    const authenticated = validateApprovedPlan(cwd, policy.workflow, descriptor);
    if ("code" in authenticated) deny(authenticated.message);
    const descriptorPlanPath = safeProjectPath(cwd, descriptor.planPath);
    if (!descriptorPlanPath) deny("External approval descriptor planPath is not a canonical project target.");
    selectedPlan = descriptorPlanPath;
    validatedPlanHash = authenticated.hash;
    externalApproval = authenticated.metadata;
    externalVerdictPath = descriptorVerdictPath;
  } catch { deny("Reviewer cannot load the external schema-v1 approval policy."); }
}
if ((tool === "Write" || tool === "Bash") && generatedPlan) {
  const resolved = resolveGeneratedPlanReviewState(cwd, policy.workflow);
  if ("code" in resolved || !pending || "code" in pending || JSON.stringify(resolved.receipt) !== JSON.stringify(pending)) deny("Reviewer requires one unchanged, regular, receipt-selected generated plan.");
  selectedPlan = resolved.planPath;
  validatedPlanHash = resolved.hash;
}

if (tool === "Write") {
  const requested = safeProjectPath(cwd, input.file_path);
  const verdictPath = generatedPlan ? receiptPath : (externalVerdictPath ?? "");
  try { if (!requested || lstatSync(requested).isSymbolicLink() || !safeExactTarget(cwd, requested, verdictPath)) deny(reason); }
  catch { if (!requested || !safeExactTarget(cwd, requested, verdictPath)) deny(reason); }
  let planHash: string | null = validatedPlanHash;
  if (!generatedPlan && !planHash) try { planHash = sha256(readFileSync(selectedPlan)); } catch { /* fail closed */ }
  if (generatedPlan) {
    const proposed = parseReviewState(input.content, policy.workflow);
    if ("code" in proposed || !pending || "code" in pending || !planHash
      || proposed.workflow !== pending.workflow || proposed.plan_file !== pending.plan_file || proposed.plan_hash !== pending.plan_hash
      || proposed.approved_session_id !== pending.approved_session_id || proposed.approved_at !== pending.approved_at
      || proposed.plan_hash !== planHash || proposed.status === "PENDING"
      || proposed.reviewer_session_id !== process.env.CLAUDE_SESSION_ID) {
      deny("review.json finalization must preserve all approval-owned fields, authenticate current generated-plan bytes, and set only final review fields for this independent reviewer.");
    }
    allow();
  }
  const verdict = parseVerdict(input.content);
  if ("code" in verdict || verdict.reviewer_session_id !== process.env.CLAUDE_SESSION_ID || !planHash || verdict.plan_hash !== planHash
    || (externalApproval !== null && (verdict.reviewer_session_id === externalApproval.approvedSession || Date.parse(verdict.reviewed_at) <= Date.parse(externalApproval.approvedAt)))) {
    deny(`The external reviewer verdict must record the current plan hash, this independent reviewer's actual session ID, and a review time after approval in the legacy strict verdict schema.`);
  }
  allow();
}
if (tool === "Bash") {
  const command = String(input.command ?? "").trim();
  const rel = selectedPlan.startsWith(`${cwd}/`) ? selectedPlan.slice(cwd.length + 1) : "";
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hashCommand = new RegExp(`^(sha256sum|shasum -a 256) (\\./)?${escaped}$`);
  if (rel && !hasUnsafeCompoundCommand(command) && hashCommand.test(command) && existsSync(selectedPlan)) allow();
  deny(`Reviewer Bash enforcement: only hashing the exact receipt-selected plan (${rel || "unavailable"}) is permitted.`);
}
allow();
