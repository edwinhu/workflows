import {
  err,
  finalizeGeneratedPlanReview,
  resolveGeneratedPlanReviewState,
  type ArtifactError,
  type ModernReviewReceipt,
} from "./approved-artifact";

export type PlanReviewSeverity = "blocker" | "advisory";
export type PlanReviewApprovalMode = "built-in-native" | "generated-plan-receipt-v1";
export type GeneratedPlanReviewPolicy = Readonly<{ workflow: string; approvalMode: PlanReviewApprovalMode }>;
export type AuthenticatedPlanReviewContext = Readonly<{
  projectDir: string; workflow: string; planFile: string; planPath: string; planHash: string; plan: string;
}>;
export type PlanReviewFindingInput = Readonly<{ severity: PlanReviewSeverity; code?: string; message: string; evidence?: readonly string[] }>;
export type PlanReviewFinding = Readonly<PlanReviewFindingInput & { checkId: string; scope: "common" | "domain" }>;
export type PlanReviewCheck = Readonly<{
  id: string;
  run(context: AuthenticatedPlanReviewContext): readonly PlanReviewFindingInput[] | Promise<readonly PlanReviewFindingInput[]>;
}>;
export type PlanReviewComposition = Readonly<{
  workflow: string; planFile: string; planHash: string; approvalReceipt: ModernReviewReceipt;
  status: "APPROVED" | "ISSUES_FOUND"; findings: readonly PlanReviewFinding[]; executedCheckIds: readonly string[];
}>;

const WORKFLOW = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const CHECK_ID = /^[a-z0-9][a-z0-9._-]*$/;
const issuedCompositions = new WeakSet<object>();
const isError = (value: unknown): value is ArtifactError => !!value && typeof value === "object" && typeof (value as ArtifactError).code === "string" && typeof (value as ArtifactError).message === "string";

function validatePolicy(policy: GeneratedPlanReviewPolicy): ArtifactError | null {
  if (!policy || typeof policy !== "object" || !WORKFLOW.test(policy.workflow)) return err("review-policy", "validated generated-plan workflow policy is required");
  if (policy.approvalMode !== "built-in-native" && policy.approvalMode !== "generated-plan-receipt-v1") return err("review-policy", "workflow policy must select a generated-plan approval mode");
  return null;
}
function normalizeChecks(common: readonly PlanReviewCheck[], domain: readonly PlanReviewCheck[]): { scope: "common" | "domain"; check: PlanReviewCheck }[] | ArtifactError {
  if (!Array.isArray(common) || common.length === 0) return err("review-checks", "at least one common check is required");
  if (!Array.isArray(domain) || domain.length === 0) return err("review-checks", "at least one domain check is required");
  const result: { scope: "common" | "domain"; check: PlanReviewCheck }[] = [];
  const ids = new Set<string>();
  for (const [scope, checks] of [["common", common], ["domain", domain]] as const) {
    const sorted = [...checks].sort((a, b) => String(a?.id).localeCompare(String(b?.id), "en", { sensitivity: "variant" }));
    for (const check of sorted) {
      if (!check || typeof check !== "object" || typeof check.id !== "string" || !CHECK_ID.test(check.id) || typeof check.run !== "function") return err("review-checks", `invalid ${scope} check`);
      if (ids.has(check.id)) return err("review-checks", `duplicate check id: ${check.id}`);
      ids.add(check.id); result.push({ scope, check });
    }
  }
  return result;
}
function normalizeFindings(value: unknown, checkId: string, scope: "common" | "domain"): readonly PlanReviewFinding[] | ArtifactError {
  if (!Array.isArray(value)) return err("review-finding", `${scope} check ${checkId} did not return a finding array`);
  const findings: PlanReviewFinding[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return err("review-finding", `${scope} check ${checkId} returned a malformed finding`);
    const finding = candidate as Record<string, unknown>;
    if ((finding.severity !== "blocker" && finding.severity !== "advisory") || typeof finding.message !== "string" || !finding.message.trim()) return err("review-finding", `${scope} check ${checkId} returned a malformed finding`);
    if (finding.code !== undefined && (typeof finding.code !== "string" || !finding.code.trim())) return err("review-finding", `${scope} check ${checkId} returned a malformed finding code`);
    if (finding.evidence !== undefined && (!Array.isArray(finding.evidence) || finding.evidence.some(item => typeof item !== "string" || !item.trim()))) return err("review-finding", `${scope} check ${checkId} returned malformed evidence`);
    findings.push(Object.freeze({ checkId, scope, severity: finding.severity, message: finding.message, ...(finding.code === undefined ? {} : { code: finding.code as string }), ...(finding.evidence === undefined ? {} : { evidence: Object.freeze([...(finding.evidence as string[])]) }) }));
  }
  return findings;
}

/** Authenticates one receipt-selected whole plan, then runs all common checks before domain checks. */
export async function composePlanReview(args: Readonly<{
  projectDir: string; policy: GeneratedPlanReviewPolicy; commonChecks: readonly PlanReviewCheck[]; domainChecks: readonly PlanReviewCheck[];
}>): Promise<PlanReviewComposition | ArtifactError> {
  if (!args || typeof args !== "object" || typeof args.projectDir !== "string" || !args.projectDir) return err("review-input", "explicit projectDir is required");
  const policyError = validatePolicy(args.policy); if (policyError) return policyError;
  const checks = normalizeChecks(args.commonChecks, args.domainChecks); if (isError(checks)) return checks;
  const resolved = resolveGeneratedPlanReviewState(args.projectDir, args.policy.workflow); if (isError(resolved)) return resolved;
  if (resolved.receipt.status !== "PENDING") return err("review-state", "plan review composition requires a PENDING authenticated receipt");
  const context = Object.freeze({ projectDir: args.projectDir, workflow: args.policy.workflow, planFile: resolved.planFile, planPath: resolved.planPath, planHash: resolved.hash, plan: resolved.planText });
  const findings: PlanReviewFinding[] = []; const executed: string[] = [];
  for (const { scope, check } of checks) {
    let raw: unknown;
    try { raw = await check.run(context); } catch (error) { return err("review-check", `${scope} check ${check.id} failed closed: ${error instanceof Error ? error.message : String(error)}`); }
    const normalized = normalizeFindings(raw, check.id, scope); if (isError(normalized)) return normalized;
    findings.push(...normalized); executed.push(check.id);
  }
  const unchanged = resolveGeneratedPlanReviewState(args.projectDir, args.policy.workflow); if (isError(unchanged)) return unchanged;
  if (unchanged.hash !== resolved.hash || unchanged.planFile !== resolved.planFile || JSON.stringify(unchanged.receipt) !== JSON.stringify(resolved.receipt)) return err("review-race", "plan identity or approval receipt changed during review");
  const composition = Object.freeze({ workflow: args.policy.workflow, planFile: resolved.planFile, planHash: resolved.hash, approvalReceipt: Object.freeze({ ...resolved.receipt }), status: findings.some(f => f.severity === "blocker") ? "ISSUES_FOUND" as const : "APPROVED" as const, findings: Object.freeze(findings), executedCheckIds: Object.freeze(executed) });
  issuedCompositions.add(composition);
  return composition;
}

/** Re-authenticates the composed plan and changes only receipt fields owned by plan review. */
export function finalizeComposedPlanReview(args: Readonly<{
  projectDir: string; policy: GeneratedPlanReviewPolicy; composition: PlanReviewComposition; reviewerSessionId: string; reviewedAt?: string;
}>): ModernReviewReceipt | ArtifactError {
  const policyError = validatePolicy(args?.policy); if (policyError) return policyError;
  if (!args.composition || !issuedCompositions.has(args.composition) || args.composition.workflow !== args.policy.workflow || !Array.isArray(args.composition.executedCheckIds) || args.composition.executedCheckIds.length === 0) return err("review-composition", "complete matching plan review composition issued by this composer is required");
  if (typeof args.reviewerSessionId !== "string" || !args.reviewerSessionId.trim()) return err("review-session", "reviewerSessionId is required");
  const resolved = resolveGeneratedPlanReviewState(args.projectDir, args.policy.workflow); if (isError(resolved)) return resolved;
  const prior = args.composition.approvalReceipt;
  if (resolved.receipt.status !== "PENDING" || resolved.hash !== args.composition.planHash || resolved.planFile !== args.composition.planFile || JSON.stringify(resolved.receipt) !== JSON.stringify(prior)) return err("review-race", "plan identity or approval receipt changed before finalization");
  return finalizeGeneratedPlanReview(
    args.projectDir,
    args.policy.workflow,
    prior,
    args.composition.status,
    args.reviewerSessionId,
    args.reviewedAt,
  );
}
