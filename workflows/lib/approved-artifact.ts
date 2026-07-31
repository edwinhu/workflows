import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

export type WorkflowName = "ds" | "dev" | "writing" | "workshop" | "workflow-creator";
export type BuiltInApprovalWorkflow = Exclude<WorkflowName, "dev">;
export type ArtifactError = { code: string; message: string };
export type ApprovalMetadata = { schemaVersion: 1; workflow: string; planHash: string; approvedSession: string; approvedAt: string };
export type ReviewerVerdict = { plan_hash: string; status: "APPROVED" | "ISSUES_FOUND"; reviewer_session_id: string; reviewed_at: string };
export type ApprovedArtifact = { hash: string; metadata?: ApprovalMetadata; verdict: ReviewerVerdict };
export type ApprovalPolicyDescriptor = {
  schemaVersion: 1;
  workflow: string;
  planPath: string;
  metadataPath: string;
  verdictPath: string;
};

const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function strictUtc(value: unknown): value is string { return typeof value === "string" && UTC.test(value) && new Date(value).toISOString() === value; }
export function err(code: string, message: string): ArtifactError { return { code, message }; }

export function parseMetadata(value: unknown, expectedWorkflow?: string): ApprovalMetadata | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("metadata-shape", "PLAN metadata must be an object");
  const m = value as Record<string, unknown>;
  const keys = ["schemaVersion", "workflow", "planHash", "approvedSession", "approvedAt"];
  const workflow = typeof m.workflow === "string" ? m.workflow : "";
  const workflowAllowed = expectedWorkflow === undefined
    ? ["ds", "writing", "workshop", "workflow-creator"].includes(workflow)
    : true;
  if (Object.keys(m).length !== keys.length || keys.some(key => !Object.hasOwn(m, key)) || m.schemaVersion !== 1
    || !workflow.trim() || !workflowAllowed || typeof m.planHash !== "string" || !HASH.test(m.planHash) || typeof m.approvedSession !== "string" || !m.approvedSession.trim() || !strictUtc(m.approvedAt)) {
    return err("metadata-schema", "PLAN metadata has an invalid strict schema");
  }
  return m as ApprovalMetadata;
}

export function parseVerdict(content: unknown): ReviewerVerdict | ArtifactError {
  if (typeof content !== "string") return err("verdict-content", "review verdict must be text");
  const header = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!header) return err("verdict-frontmatter", "review verdict needs YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of header[1].split("\n")) {
    const match = line.match(/^([a-z_]+): (.+)$/);
    if (!match || Object.hasOwn(fields, match[1])) return err("verdict-schema", "review verdict has invalid frontmatter");
    fields[match[1]] = match[2];
  }
  const keys = ["plan_hash", "status", "reviewer_session_id", "reviewed_at"];
  if (Object.keys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) || !HASH.test(fields.plan_hash)
    || !["APPROVED", "ISSUES_FOUND"].includes(fields.status) || !fields.reviewer_session_id.trim() || !strictUtc(fields.reviewed_at)) {
    return err("verdict-schema", "review verdict has an invalid strict schema");
  }
  return fields as ReviewerVerdict;
}

export type ArtifactReadOptions = {
  beforeOpen?: (path: string) => void;
  noFollowFlag?: number;
};

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(fromRoot);
}

function rejectSymlinkComponents(root: string, path: string): ArtifactError | undefined {
  const canonicalRoot = realpathSync(root);
  const fromRoot = relative(canonicalRoot, path);
  if (!contained(canonicalRoot, path) || isAbsolute(fromRoot)) return err("policy-path", "approval artifact path escapes the project root");
  let candidate = canonicalRoot;
  for (const segment of fromRoot.split(/[\\/]/)) {
    candidate = join(candidate, segment);
    const entry = lstatSync(candidate);
    if (entry.isSymbolicLink()) {
      try {
        if (!contained(canonicalRoot, realpathSync(candidate))) return err("policy-path", "approval artifact path escapes the project root");
      } catch {
        return err("artifact-type", `approval artifact path contains a symbolic link: ${path}`);
      }
      return err("artifact-type", `approval artifact path contains a symbolic link: ${path}`);
    }
  }
  const final = lstatSync(path);
  if (!final.isFile()) return err("artifact-type", `approval artifact is not a regular file: ${path}`);
  const canonical = realpathSync(path);
  if (!contained(canonicalRoot, canonical)) return err("policy-path", "approval artifact path escapes the project root");
  return undefined;
}

function readArtifactSnapshot(root: string, path: string, code = "artifact-read", options: ArtifactReadOptions = {}): Buffer | ArtifactError {
  try {
    const unsafe = rejectSymlinkComponents(root, path);
    if (unsafe) return unsafe;
    options.beforeOpen?.(path);
    const changed = rejectSymlinkComponents(root, path);
    if (changed) return changed;
    return readFileSync(path);
  } catch {
    return err(code, `cannot read approval artifact: ${path}`);
  }
}
function readJsonSnapshot(value: Buffer | ArtifactError, path: string): unknown | ArtifactError {
  if (isError(value)) return value;
  try { return JSON.parse(value.toString("utf8")); } catch { return err("metadata-read", `cannot parse ${path}`); }
}
function isError(value: unknown): value is ArtifactError { return !!value && typeof value === "object" && "code" in value; }
function isBuiltInWorkflow(workflow: string): workflow is WorkflowName {
  return ["ds", "dev", "writing", "workshop", "workflow-creator"].includes(workflow);
}

export function parseApprovalPolicyDescriptor(value: unknown, workflow: string): ApprovalPolicyDescriptor | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("policy-schema", "approval policy must be an object");
  const policy = value as Record<string, unknown>;
  const keys = ["schemaVersion", "workflow", "planPath", "metadataPath", "verdictPath"];
  if (Object.keys(policy).length !== keys.length || keys.some(key => !Object.hasOwn(policy, key)) || policy.schemaVersion !== 1
    || typeof policy.workflow !== "string" || !policy.workflow.trim()
    || typeof policy.planPath !== "string" || typeof policy.metadataPath !== "string" || typeof policy.verdictPath !== "string") {
    return err("policy-schema", "approval policy has an invalid strict schema");
  }
  if (policy.workflow !== workflow) return err("policy-workflow-mismatch", `approval policy authorizes ${policy.workflow}, not ${workflow}`);
  return policy as ApprovalPolicyDescriptor;
}

function resolvePolicyPath(projectDir: string, value: string): string | ArtifactError {
  if (!value || isAbsolute(value) || value.includes("\\")) return err("policy-path", "approval artifact paths must be project-relative");
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) return err("policy-path", "approval artifact paths must be canonical project-relative paths");
  const root = realpathSync(projectDir);
  const candidate = join(root, value);
  if (!existsSync(candidate)) return err("missing-artifact", `required approval artifact is missing: ${value}`);
  try {
    const unsafe = rejectSymlinkComponents(root, candidate);
    if (unsafe) return unsafe;
  } catch {
    return err("missing-artifact", `required approval artifact is missing: ${value}`);
  }
  return candidate;
}

export function validateApprovedArtifact(projectDir: string, workflow: string, currentSession: unknown, descriptor?: ApprovalPolicyDescriptor, readOptions: ArtifactReadOptions = {}): ApprovedArtifact | ArtifactError {
  const root = realpathSync(projectDir);
  if (descriptor !== undefined && isBuiltInWorkflow(workflow)) return err("policy-ambiguous", "built-in workflows cannot override approval artifact paths");
  if (descriptor === undefined && !isBuiltInWorkflow(workflow)) return err("unknown-workflow", "external workflows require an explicit approval policy");

  let planPath: string;
  let verdictPath: string;
  let metadataPath: string | undefined;
  if (descriptor !== undefined) {
    const policy = parseApprovalPolicyDescriptor(descriptor, workflow);
    if (isError(policy)) return policy;
    const resolvedPlan = resolvePolicyPath(root, policy.planPath);
    if (isError(resolvedPlan)) return resolvedPlan;
    const resolvedMetadata = resolvePolicyPath(root, policy.metadataPath);
    if (isError(resolvedMetadata)) return resolvedMetadata;
    const resolvedVerdict = resolvePolicyPath(root, policy.verdictPath);
    if (isError(resolvedVerdict)) return resolvedVerdict;
    if (new Set([resolvedPlan, resolvedMetadata, resolvedVerdict]).size !== 3) return err("policy-path", "approval artifact paths must identify distinct files");
    planPath = resolvedPlan;
    metadataPath = resolvedMetadata;
    verdictPath = resolvedVerdict;
  } else {
    const planning = join(root, ".planning");
    planPath = join(planning, "PLAN.md");
    verdictPath = join(planning, "PLAN_REVIEWED.md");
    metadataPath = workflow === "dev" ? undefined : join(planning, "PLAN.meta.json");
    if (!existsSync(planPath) || !existsSync(verdictPath)) return err("missing-artifact", "PLAN.md and PLAN_REVIEWED.md are required");
  }

  const planSnapshot = readArtifactSnapshot(root,planPath, "artifact-read", readOptions);
  if (isError(planSnapshot)) return planSnapshot;
  const verdictSnapshot = readArtifactSnapshot(root,verdictPath, "verdict-read", readOptions);
  if (isError(verdictSnapshot)) return verdictSnapshot;
  const hash = sha256(planSnapshot);
  const verdict = parseVerdict(verdictSnapshot.toString("utf8"));
  if (isError(verdict)) return verdict;
  if (verdict.status !== "APPROVED" || verdict.plan_hash !== hash) return err("stale-verdict", "review verdict is not APPROVED for current PLAN.md bytes");
  if (typeof currentSession !== "string" || !currentSession.trim() || currentSession === verdict.reviewer_session_id) return err("session-separation", "implementation session must differ from reviewer session");
  if (workflow === "dev") return { hash, verdict };
  if (metadataPath === undefined) return err("missing-artifact", "PLAN metadata is required");
  const metadataSnapshot = readJsonSnapshot(readArtifactSnapshot(root,metadataPath, "metadata-read", readOptions), metadataPath);
  if (isError(metadataSnapshot)) return metadataSnapshot;
  const metadata = parseMetadata(metadataSnapshot, workflow);
  if (isError(metadata)) return metadata;
  if (metadata.workflow !== workflow) return err("workflow-mismatch", `PLAN metadata authorizes ${metadata.workflow}, not ${workflow}`);
  if (metadata.planHash !== hash) return err("stale-metadata", "PLAN metadata does not authenticate current bytes");
  if (metadata.approvedSession === verdict.reviewer_session_id || metadata.approvedSession === currentSession || Date.parse(verdict.reviewed_at) <= Date.parse(metadata.approvedAt)) {
    return err("approval-chronology", `${workflow} approval, review, and implementation must be distinct chronological sessions`);
  }
  return { hash, metadata, verdict };
}

export function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    const bytes = Buffer.from(content, "utf8");
    for (let offset = 0; offset < bytes.length;) { const written = writeSync(fd, bytes, offset, bytes.length - offset); if (written <= 0) throw new Error("write made no progress"); offset += written; }
    fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, path);
  } finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch {} }
}

export function persistApprovedPlan(projectDir: string, workflow: Exclude<WorkflowName, "dev">, plan: string, session: string): void {
  if (!session.trim()) throw new Error("approval session must be nonempty");
  const planning = join(projectDir, ".planning");
  mkdirSync(planning, { recursive: true });
  atomicWrite(join(planning, "PLAN.md"), plan);
  atomicWrite(join(planning, "PLAN.meta.json"), `${JSON.stringify({ schemaVersion: 1, workflow, planHash: sha256(Buffer.from(plan, "utf8")), approvedSession: session, approvedAt: new Date().toISOString() }, null, 2)}\n`);
  try { unlinkSync(join(planning, "PLAN_REVIEWED.md")); } catch {}
}

/** Compatibility export for callers not yet migrated to the policy-neutral name. */
export function persistDsApprovedPlan(projectDir: string, plan: string, session: string): void {
  persistApprovedPlan(projectDir, "ds", plan, session);
}


export type ImplementationApprovalBindingV1 = Readonly<{ taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string; implementationSession: string }>;
export type CapturedImplementationApprovalV1 = Readonly<{ schemaVersion: 1; approvalBundleDigest: string; planDigest: string; workflow: string; taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string; approvalSession: string; reviewerSession: string; implementationSession: string; approvedAt: string; reviewedAt: string; terminalReleaseAuthorized: false }>;

export function validateBuiltInImplementationApproval(artifact: ApprovedArtifact, expectedWorkflow: string, binding: ImplementationApprovalBindingV1): CapturedImplementationApprovalV1 | ArtifactError {
  if (!artifact.metadata || artifact.metadata.workflow !== expectedWorkflow) return err("workflow-mismatch", "built-in approval workflow was substituted");
  if (!binding.taskIdentity.trim() || !HASH.test(binding.taskContractDigest) || !HASH.test(binding.preDispatchObservationDigest)) return err("binding-schema", "implementation approval binding is invalid");
  if (typeof binding.implementationSession !== "string" || !binding.implementationSession.trim() || new Set([artifact.metadata.approvedSession, artifact.verdict.reviewer_session_id, binding.implementationSession]).size !== 3) return err("session-separation", "approval, review, and implementation sessions must differ");
  const approvalBundleDigest = sha256(Buffer.from(JSON.stringify({
    schemaVersion: 1,
    planDigest: artifact.hash,
    workflow: expectedWorkflow,
    taskIdentity: binding.taskIdentity,
    taskContractDigest: binding.taskContractDigest,
    preDispatchObservationDigest: binding.preDispatchObservationDigest,
    approvalSession: artifact.metadata.approvedSession,
    reviewerSession: artifact.verdict.reviewer_session_id,
    implementationSession: binding.implementationSession,
  }), "utf8"));
  return Object.freeze({ schemaVersion: 1, approvalBundleDigest, planDigest: artifact.hash, workflow: expectedWorkflow, taskIdentity: binding.taskIdentity, taskContractDigest: binding.taskContractDigest, preDispatchObservationDigest: binding.preDispatchObservationDigest, approvalSession: artifact.metadata.approvedSession, reviewerSession: artifact.verdict.reviewer_session_id, implementationSession: binding.implementationSession, approvedAt: artifact.metadata.approvedAt, reviewedAt: artifact.verdict.reviewed_at, terminalReleaseAuthorized: false });
}
type CapturedApprovalMetadataV1 = ApprovalMetadata & Readonly<{ taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string }>;

import { copyCapturedApprovalBundle, digestBytes, type CapturedApprovalBundleV1 } from "./approval-bundle.ts";

function parseCapturedApprovalMetadata(value: unknown, expectedWorkflow: string): CapturedApprovalMetadataV1 | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("metadata-shape", "PLAN metadata must be an object");
  const metadata = value as Record<string, unknown>;
  const keys = ["schemaVersion", "workflow", "planHash", "approvedSession", "approvedAt", "taskIdentity", "taskContractDigest", "preDispatchObservationDigest"];
  if (Object.keys(metadata).length !== keys.length || keys.some(key => !Object.hasOwn(metadata, key)) || metadata.schemaVersion !== 1
    || metadata.workflow !== expectedWorkflow || typeof metadata.planHash !== "string" || !HASH.test(metadata.planHash)
    || typeof metadata.approvedSession !== "string" || !metadata.approvedSession.trim() || !strictUtc(metadata.approvedAt)
    || typeof metadata.taskIdentity !== "string" || !metadata.taskIdentity.trim()
    || typeof metadata.taskContractDigest !== "string" || !HASH.test(metadata.taskContractDigest)
    || typeof metadata.preDispatchObservationDigest !== "string" || !HASH.test(metadata.preDispatchObservationDigest)) {
    return err("metadata-schema", "captured approval metadata has an invalid strict schema");
  }
  return metadata as CapturedApprovalMetadataV1;
}

export function validateCapturedApprovalBundle(bundle: CapturedApprovalBundleV1, expectedWorkflow: string, binding: ImplementationApprovalBindingV1): CapturedImplementationApprovalV1 | ArtifactError {
  if (!bundle || bundle.schemaVersion !== 1) return err("bundle-schema", "approval bundle has an invalid schema");
  const snapshot = copyCapturedApprovalBundle(bundle);
  let descriptor: unknown; let metadataValue: unknown;
  try { descriptor = JSON.parse(snapshot.descriptorBytes.toString("utf8")); metadataValue = JSON.parse(snapshot.metadataBytes.toString("utf8")); } catch { return err("bundle-schema", "approval bundle contains malformed JSON"); }
  const policy = parseApprovalPolicyDescriptor(descriptor, expectedWorkflow); if (isError(policy)) return policy;
  const metadata = parseCapturedApprovalMetadata(metadataValue, expectedWorkflow); if (isError(metadata)) return metadata;
  const verdict = parseVerdict(Buffer.from(snapshot.verdictBytes).toString("utf8")); if (isError(verdict)) return verdict;
  const planDigest = digestBytes(snapshot.planBytes);
  if (metadata.workflow !== expectedWorkflow) return err("workflow-mismatch", "approval workflow was substituted");
  if (metadata.planHash !== planDigest || verdict.plan_hash !== planDigest || verdict.status !== "APPROVED") return err("stale-approval", "approval does not authenticate captured plan bytes");
  if (!binding.taskIdentity.trim() || !HASH.test(binding.taskContractDigest) || !HASH.test(binding.preDispatchObservationDigest)) return err("binding-schema", "implementation approval binding is invalid");
  for (const [key, expected] of [["taskIdentity", binding.taskIdentity], ["taskContractDigest", binding.taskContractDigest], ["preDispatchObservationDigest", binding.preDispatchObservationDigest]] as const) { if (metadata[key] !== expected) return err("binding-mismatch", `${key} was substituted`); }
  if (typeof binding.implementationSession !== "string" || !binding.implementationSession.trim() || new Set([metadata.approvedSession, verdict.reviewer_session_id, binding.implementationSession]).size !== 3) return err("session-separation", "approval, review, and implementation sessions must differ");
  if (Date.parse(verdict.reviewed_at) <= Date.parse(metadata.approvedAt)) return err("approval-chronology", "review must be strictly later than approval");
  const all = Buffer.concat([Buffer.from(snapshot.descriptorBytes), Buffer.from(snapshot.planBytes), Buffer.from(snapshot.metadataBytes), Buffer.from(snapshot.verdictBytes)]);
  return Object.freeze({ schemaVersion: 1, approvalBundleDigest: digestBytes(all), planDigest, workflow: expectedWorkflow, taskIdentity: metadata.taskIdentity, taskContractDigest: metadata.taskContractDigest, preDispatchObservationDigest: metadata.preDispatchObservationDigest, approvalSession: metadata.approvedSession, reviewerSession: verdict.reviewer_session_id, implementationSession: binding.implementationSession, approvedAt: metadata.approvedAt, reviewedAt: verdict.reviewed_at, terminalReleaseAuthorized: false });
}
