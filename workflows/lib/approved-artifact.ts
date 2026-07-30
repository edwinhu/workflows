import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

export type WorkflowName = "ds" | "dev";
export type ArtifactError = { code: string; message: string };
export type ApprovalMetadata = { schemaVersion: 1; planHash: string; approvedSession: string; approvedAt: string };
export type ReviewerVerdict = { plan_hash: string; status: "APPROVED" | "ISSUES_FOUND"; reviewer_session_id: string; reviewed_at: string };
export type ApprovedArtifact = { hash: string; metadata?: ApprovalMetadata; verdict: ReviewerVerdict };

const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function strictUtc(value: unknown): value is string { return typeof value === "string" && UTC.test(value) && new Date(value).toISOString() === value; }
export function err(code: string, message: string): ArtifactError { return { code, message }; }

export function parseMetadata(value: unknown): ApprovalMetadata | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("metadata-shape", "PLAN metadata must be an object");
  const m = value as Record<string, unknown>;
  const keys = ["schemaVersion", "planHash", "approvedSession", "approvedAt"];
  if (Object.keys(m).length !== keys.length || keys.some(key => !Object.hasOwn(m, key)) || m.schemaVersion !== 1
    || typeof m.planHash !== "string" || !HASH.test(m.planHash) || typeof m.approvedSession !== "string" || !m.approvedSession.trim() || !strictUtc(m.approvedAt)) {
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

function readJson(path: string): unknown | ArtifactError {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return err("metadata-read", `cannot parse ${path}`); }
}
function isError(value: unknown): value is ArtifactError { return !!value && typeof value === "object" && "code" in value; }

export function validateApprovedArtifact(projectDir: string, workflow: WorkflowName, currentSession: unknown): ApprovedArtifact | ArtifactError {
  const planning = join(projectDir, ".planning");
  const planPath = join(planning, "PLAN.md");
  const verdictPath = join(planning, "PLAN_REVIEWED.md");
  if (!existsSync(planPath) || !existsSync(verdictPath)) return err("missing-artifact", "PLAN.md and PLAN_REVIEWED.md are required");
  const hash = sha256(readFileSync(planPath));
  const verdict = parseVerdict(readFileSync(verdictPath, "utf8"));
  if (isError(verdict)) return verdict;
  if (verdict.status !== "APPROVED" || verdict.plan_hash !== hash) return err("stale-verdict", "review verdict is not APPROVED for current PLAN.md bytes");
  if (typeof currentSession !== "string" || !currentSession.trim() || currentSession === verdict.reviewer_session_id) return err("session-separation", "implementation session must differ from reviewer session");
  if (workflow === "dev") return { hash, verdict };
  const metadata = parseMetadata(readJson(join(planning, "PLAN.meta.json")));
  if (isError(metadata)) return metadata;
  if (metadata.planHash !== hash) return err("stale-metadata", "PLAN metadata does not authenticate current bytes");
  if (metadata.approvedSession === verdict.reviewer_session_id || metadata.approvedSession === currentSession || Date.parse(verdict.reviewed_at) <= Date.parse(metadata.approvedAt)) {
    return err("approval-chronology", "DS approval, review, and implementation must be distinct chronological sessions");
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

export function persistDsApprovedPlan(projectDir: string, plan: string, session: string): void {
  if (!session.trim()) throw new Error("approval session must be nonempty");
  const planning = join(projectDir, ".planning");
  mkdirSync(planning, { recursive: true });
  atomicWrite(join(planning, "PLAN.md"), plan);
  atomicWrite(join(planning, "PLAN.meta.json"), `${JSON.stringify({ schemaVersion: 1, planHash: sha256(Buffer.from(plan, "utf8")), approvedSession: session, approvedAt: new Date().toISOString() }, null, 2)}\n`);
  try { unlinkSync(join(planning, "PLAN_REVIEWED.md")); } catch {}
}
