#!/usr/bin/env bun
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hookActorIdentity, parseApprovalPolicyDescriptor, parseReviewState, parseVerdict, resolveGeneratedPlanReviewState, sha256, validateApprovedPlan } from "../workflows/lib/approved-artifact.ts";
import { safeExactTarget, safeProjectPath, hasUnsafeCompoundCommand } from "./_path_safety.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, context, deny, denyOnCrash, readPayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("REVIEWER VERDICT GUARD");

const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) deny("Reviewer verdict guard requires exactly one known workflow policy.");
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
// The reviewer's identity comes from the hook PAYLOAD. process.env.CLAUDE_SESSION_ID does not
// exist in a real hook process, which made this comparison `!== undefined` and denied every
// finalization; see hookActorIdentity.
const actor = hookActorIdentity(payload);
const reason = "Reviewer read-only enforcement: return findings without modifying artifacts, state, or project files.";
if (tool === "Edit") deny(reason);

/** Report an identity failure as itself. Always names the required value, because a subagent
 *  cannot read its own agent_id and this deny is its fallback way to learn it. */
function denySeparation(detail: string): never {
  deny(`Reviewer session separation failure: ${detail}. This reviewer's actor identity is ${actor === null ? "unavailable" : `"${actor}"`}; record it verbatim as reviewer_session_id, and it must differ from the approving actor.`);
}

// Schema-v2 routing (origin/main): the generated-plan receipt path is everything that is not the
// fixed external descriptor mode, which is broader than the old `approvalPolicy === undefined`.
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
    // A session-separation failure used to surface as the generic field-preservation message
    // below, so the one cause that made the reviewer unable to finalize was invisible. Report it
    // as itself, and name the exact identity this actor must record.
    if ("code" in proposed && proposed.code === "session-separation") denySeparation(proposed.message);
    if ("code" in proposed) deny(`review.json finalization is invalid (${proposed.code}): ${proposed.message}.`);
    if (!actor) denySeparation("the hook payload carried no usable session_id, so this reviewer has no verifiable identity");
    if (proposed.reviewer_session_id !== actor) denySeparation(`reviewer_session_id must be exactly the writing actor's identity "${actor}"`);
    if (!pending || "code" in pending || !planHash
      || proposed.workflow !== pending.workflow || proposed.plan_file !== pending.plan_file || proposed.plan_hash !== pending.plan_hash
      || proposed.approved_session_id !== pending.approved_session_id || proposed.approved_at !== pending.approved_at
      || proposed.plan_hash !== planHash || proposed.status === "PENDING") {
      deny("review.json finalization must preserve all approval-owned fields, authenticate current generated-plan bytes, and set only final review fields for this independent reviewer.");
    }
    allow();
  }
  const verdict = parseVerdict(input.content);
  if ("code" in verdict) deny(`${policy.reviewerVerdict} must use the legacy strict verdict schema (${verdict.code}): ${verdict.message}.`);
  if (!actor) denySeparation("the hook payload carried no usable session_id, so this reviewer has no verifiable identity");
  if (verdict.reviewer_session_id !== actor) denySeparation(`reviewer_session_id must be exactly the writing actor's identity "${actor}"`);
  if (externalApproval !== null && verdict.reviewer_session_id === externalApproval.approvedSession) denySeparation("the approving actor cannot also be the reviewer");
  if (!planHash || verdict.plan_hash !== planHash
    || (externalApproval !== null && Date.parse(verdict.reviewed_at) <= Date.parse(externalApproval.approvedAt))) {
    deny(`${policy.reviewerVerdict} must record the current plan hash and a review time after approval in the legacy strict verdict schema.`);
  }
  allow();
}
if (tool === "Bash") {
  const command = String(input.command ?? "").trim();
  const rel = selectedPlan.startsWith(`${cwd}/`) ? selectedPlan.slice(cwd.length + 1) : "";
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hashCommand = new RegExp(`^(sha256sum|shasum -a 256) (\\./)?${escaped}$`);
  // A subagent cannot read its own agent_id, so it cannot construct the actor identity the
  // finalization write must carry. The pre-finalization rehash is mandatory and always precedes
  // that write, so this allow doubles as the identity delivery channel. PreToolUse accepts
  // additionalContext (scripts/checks/hook_output_schema.py), and emitting it without a
  // permissionDecision leaves the call permitted.
  if (rel && !hasUnsafeCompoundCommand(command) && hashCommand.test(command) && existsSync(selectedPlan)) {
    if (actor) {
      context("PreToolUse", `Reviewer actor identity for this review: ${actor}\nWrite this string verbatim as reviewer_session_id when finalizing the review receipt. Do not substitute any other value.`);
    }
    allow();
  }
  deny(`Reviewer Bash enforcement: only hashing the exact receipt-selected plan (${rel || "unavailable"}) is permitted.`);
}
allow();
