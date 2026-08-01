/**
 * WHAT THE ACTOR-SEPARATION INVARIANT ACTUALLY PROVES — READ BEFORE CITING IT.
 *
 * The gates in this repo enforce a real but NARROW property, and it is easy to read far more into
 * `approver != implementer` than the mechanism can support. State it exactly.
 *
 * IT PROVES
 *   Under a canonical receipt whose recorded `plan_hash` matches the current bytes of the selected
 *   generated plan and whose `status` is APPROVED, the actor performing a gated mutation is a
 *   DIFFERENT HOOK ACTOR from the recorded approver and from the recorded reviewer — three distinct
 *   `(session_id, agent_id)` tuples, as observed on the tool calls themselves. Nothing more.
 *
 * IT DOES NOT PROVE
 *   - That the implementer is not a DESCENDANT of the approver. In single-conversation /dev it
 *     always is: the approving conversation dispatches the implementer, so "different actor" means
 *     "different subagent of the same conversation", not "arm's length". `hooks/subagent-start.ts`
 *     additionally injects the approved plan context into that subagent.
 *   - Independence of JUDGMENT. Approver, reviewer, and implementer are the same model, in the same
 *     repository, reading the same plan. A distinct `agent_id` is an identity fact, not evidence of
 *     an independent viewpoint. Do not describe this invariant as "independent review" in the sense
 *     a human reviewer would mean.
 *   - Anything about Bash-based mutation beyond what `hooks/_bash_mutation.ts` catches. That
 *     classifier is a deny-biased DENYLIST; a command whose writes happen inside an opaque
 *     executable (`make`, `cargo build`, `./scripts/build.sh`, a project binary) is admitted by
 *     design, because denying every unrecognized command would deny the orchestrator's own checks.
 *   - Anything about REPOSITORY state. The Bash classifier's git rules cover subcommands that change
 *     the content of files in the WORKTREE, which is what "may not implement" is about. `git add`,
 *     `commit`, `push`, `tag`, `fetch`, `branch`, `update-index`, and `hash-object -w` all mutate the
 *     index, the object database, refs, or a remote, and are deliberately out of scope here — they
 *     record or publish bytes that were themselves gated when they were written. If publishing is
 *     what needs governing, it needs its own control; do not read this one as covering it.
 *   - Any lineage property at all. `hooks/lineage.ts` is MONITORED TELEMETRY, not a control: it can
 *     observe a reviewer that dispatched its own implementer DIRECTLY, only when undocumented
 *     on-disk subagent metadata resolves. It FAILS OPEN otherwise — that metadata was missing for
 *     41% of agents measured on this machine (503 of 1236) — and one extra hop through any
 *     intermediate agent is invisible to it. A positive from it is evidence; a negative is nothing.
 *
 * The honest summary: this is a separation-of-actors control that raises the cost of self-approval
 * and catches the structurally lazy path. It is not a proof of independence, and a future reader who
 * treats `approver != implementer` as one will over-trust it.
 */
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, unlinkSync, writeSync, type BigIntStats } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

export type WorkflowName = "ds" | "dev" | "work" | "writing" | "workshop" | "workflow-creator";
export type BuiltInApprovalWorkflow = WorkflowName;
export type ArtifactError = { code: string; message: string };
export type ApprovalMetadata = { schemaVersion: 1; workflow: string; planHash: string; approvedSession: string; approvedAt: string };
/**
 * `reviewer_session_id` and `approved_session_id` hold an ACTOR IDENTITY, not a raw session id.
 *
 * Claude Code never exports CLAUDE_SESSION_ID to a hook process, so the old
 * `process.env.CLAUDE_SESSION_ID` comparison was `undefined` on every real invocation and every
 * receipt finalization denied. CLAUDE_CODE_SESSION_ID is no substitute: it is session-TREE-wide and
 * byte-identical in a parent conversation and its Agent()-dispatched subagent, so
 * reviewer != approver could never hold. The hook stdin payload is the only source that separates
 * them: it carries `session_id` for every call and `agent_id` ONLY when the call originates inside a
 * subagent. `hookActorIdentity` combines the two, so the parent conversation and each subagent it
 * dispatches are distinct actors within one conversation.
 */
export type ReviewerVerdict = { plan_hash: string; status: "APPROVED" | "ISSUES_FOUND"; reviewer_session_id: string; reviewed_at: string };
export type ModernReviewReceipt = { workflow: BuiltInApprovalWorkflow; plan_file: string; plan_hash: string; approved_session_id: string; approved_at: string; status: "PENDING" | "APPROVED" | "ISSUES_FOUND"; reviewer_session_id: string; reviewed_at: string };
export type ResolvedGeneratedPlan = { planFile: string; planPath: string; hash: string; receipt: ModernReviewReceipt };
export type AuthenticatedPlan = { hash: string; planFile?: string; planPath?: string; receipt?: ModernReviewReceipt; metadata: ApprovalMetadata; layout: "canonical" | "canonical-with-legacy-provenance" | "external" };
export type ApprovedArtifact = { hash: string; planFile?: string; planPath?: string; receipt?: ModernReviewReceipt; metadata?: ApprovalMetadata; verdict: ReviewerVerdict };
export type BuiltInArtifactLayout = "canonical" | "canonical-with-legacy-provenance" | "legacy" | "conflict";
export type PlanningLifecycle =
  | { kind: "canonical"; resolved: ResolvedGeneratedPlan }
  | { kind: "blocked"; reason: string }
  | { kind: "none" };
export type ApprovalPolicyDescriptor = { schemaVersion: 1; workflow: string; planPath: string; metadataPath: string; verdictPath: string };

const HASH = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MODERN_WORKFLOWS = new Set<BuiltInApprovalWorkflow>(["ds", "dev", "work", "writing", "workshop", "workflow-creator"]);
const RESERVED_PLAN_FILES = new Set(["PLAN.md", "PLAN_REVIEWED.md", "REVIEW.md", "AUTOMATED_REVIEW.md", "HUMAN_REVIEW.md", "IMPLEMENT_COMPLETE.md", "VALIDATION.md"]);

export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function strictUtc(value: unknown): value is string { return typeof value === "string" && UTC.test(value) && new Date(value).toISOString() === value; }
export function err(code: string, message: string): ArtifactError { return { code, message }; }
function isError(value: unknown): value is ArtifactError { return !!value && typeof value === "object" && "code" in value; }
function isBuiltInWorkflow(workflow: string): workflow is BuiltInApprovalWorkflow { return MODERN_WORKFLOWS.has(workflow as BuiltInApprovalWorkflow); }
function isModernWorkflow(workflow: string): workflow is BuiltInApprovalWorkflow { return MODERN_WORKFLOWS.has(workflow as BuiltInApprovalWorkflow); }

/** Separator between the two payload components. Rejected inside either component so the
 *  composite is unambiguous and one actor can never spell another actor's identity. */
const ACTOR_SEPARATOR = "#";

/**
 * The actor identity of the tool call that produced this hook payload.
 *
 * A parent-conversation call is `<session_id>`; a subagent call is `<session_id>#<agent_id>`.
 * Returns null when the payload carries no usable identity — callers must fail closed, never
 * substitute a default. Reading `process.env.CLAUDE_SESSION_ID` here instead is the original bug:
 * Claude Code does not set it.
 */
export function hookActorIdentity(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const fields = payload as Record<string, unknown>;
  const session = fields.session_id;
  if (typeof session !== "string" || !session.trim() || session.includes(ACTOR_SEPARATOR)) return null;
  const agent = fields.agent_id;
  if (agent === undefined || agent === null) return session;
  if (typeof agent !== "string" || !agent.trim() || agent.includes(ACTOR_SEPARATOR)) return null;
  return `${session}${ACTOR_SEPARATOR}${agent}`;
}

/** True when this payload came from inside a dispatched subagent rather than the conversation. */
export function isSubagentPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const agent = (payload as Record<string, unknown>).agent_id;
  return typeof agent === "string" && agent.trim() !== "";
}

/**
 * WHY AN ACTOR HAS A ROLE, AND WHY approver != implementer NEEDS ONE.
 *
 * Three actors matter: the one that APPROVED the plan, the one that REVIEWED it, and the one that
 * EXECUTES the work. All three must differ. The trap is that the admission hook fires on the
 * DISPATCHING call — the parent conversation's `Agent`/`Workflow` tool call — whose payload carries
 * no `agent_id` because the implementer subagent does not exist yet. Reading that dispatcher as
 * "the implementer" makes approver == implementer structurally true in single-conversation /dev
 * (the conversation approves the plan and then dispatches), which is why the rule was dropped.
 *
 * Naming the role restores it. A `dispatch` actor is admitted while equal to the approver, because
 * it is delegating rather than executing. An `implement` actor carries the full three-way rule, and
 * its identity is only ever available on the implementer subagent's OWN tool calls, which carry its
 * distinct `agent_id`. A bare string is an `implement` actor: the strict reading is the default, so
 * a caller that has not thought about its role gets the strong rule rather than the weak one.
 */
export type ActorRole = "dispatch" | "implement";
export type ActorIdentity = Readonly<{ role: ActorRole; identity: string }>;
const ACTOR_ROLES = new Set<ActorRole>(["dispatch", "implement"]);
export function parseActorIdentity(value: unknown): ActorIdentity | ArtifactError {
  const invalid = err("session-separation", "a valid actor identity and role are required; the caller supplied none");
  if (typeof value === "string") return value.trim() ? Object.freeze({ role: "implement" as const, identity: value }) : invalid;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid;
  const actor = value as Record<string, unknown>;
  if (Object.keys(actor).length !== 2 || !ACTOR_ROLES.has(actor.role as ActorRole)) return invalid;
  if (typeof actor.identity !== "string" || !actor.identity.trim()) return invalid;
  return Object.freeze({ role: actor.role as ActorRole, identity: actor.identity });
}

/**
 * The one place the actor-separation rule is written down. Every gate routes through it so a
 * relaxation cannot be applied to one call site and forgotten at another.
 */
function actorSeparation(approvedSession: string, reviewerSession: string, actor: ActorIdentity): ArtifactError | undefined {
  if (reviewerSession === approvedSession) return err("session-separation", "approval and review actors must differ");
  if (reviewerSession === actor.identity) return err("session-separation", "review and implementation actors must differ");
  // The dispatcher delegates the work to a subagent that will have its own identity; only an actor
  // that claims to execute the work is held to this.
  if (actor.role === "implement" && approvedSession === actor.identity) return err("session-separation", "approval and implementation actors must differ");
  return undefined;
}

export function parseMetadata(value: unknown, expectedWorkflow?: string): ApprovalMetadata | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("metadata-shape", "PLAN metadata must be an object");
  const metadata = value as Record<string, unknown>;
  const keys = ["schemaVersion", "workflow", "planHash", "approvedSession", "approvedAt"];
  if (Object.keys(metadata).length !== keys.length || keys.some(key => !Object.hasOwn(metadata, key)) || metadata.schemaVersion !== 1
    || typeof metadata.workflow !== "string" || !metadata.workflow.trim() || (expectedWorkflow !== undefined && metadata.workflow !== expectedWorkflow)
    || typeof metadata.planHash !== "string" || !HASH.test(metadata.planHash)
    || typeof metadata.approvedSession !== "string" || !metadata.approvedSession.trim() || !strictUtc(metadata.approvedAt)) return err("metadata-schema", "PLAN metadata has an invalid strict schema");
  return metadata as ApprovalMetadata;
}

function parseFrontmatter(content: unknown): Record<string, string> | ArtifactError {
  if (typeof content !== "string") return err("verdict-content", "review verdict must be text");
  const header = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!header) return err("verdict-frontmatter", "review verdict needs YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of header[1].split("\n")) {
    const match = line.match(/^([a-z_]+): (.+)$/);
    if (!match || Object.hasOwn(fields, match[1])) return err("verdict-schema", "review verdict has invalid frontmatter");
    fields[match[1]] = match[2];
  }
  return fields;
}
export function parseVerdict(content: unknown): ReviewerVerdict | ArtifactError {
  const fields = parseFrontmatter(content); if (isError(fields)) return fields;
  const keys = ["plan_hash", "status", "reviewer_session_id", "reviewed_at"];
  if (Object.keys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) || !HASH.test(fields.plan_hash)
    || !["APPROVED", "ISSUES_FOUND"].includes(fields.status) || !fields.reviewer_session_id.trim() || !strictUtc(fields.reviewed_at)) return err("verdict-schema", "review verdict has an invalid strict schema");
  return fields as ReviewerVerdict;
}

function parseFlatStringJson(content: unknown): Record<string, string> | ArtifactError {
  if (typeof content !== "string") return err("review-content", "review state must be JSON text");
  const text = content.trim(); let index = 0;
  const skip = () => { while (/\s/.test(text[index] ?? "")) index++; };
  const string = (): string | ArtifactError => {
    skip(); if (text[index] !== '"') return err("review-json", "review state values must be JSON strings");
    const start = index++; let escaped = false;
    while (index < text.length) {
      const char = text[index++];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') { try { return JSON.parse(text.slice(start, index)); } catch { return err("review-json", "review state contains an invalid JSON string"); } }
    }
    return err("review-json", "review state contains an unterminated JSON string");
  };
  skip(); if (text[index++] !== "{") return err("review-json", "review state must be one JSON object");
  const fields: Record<string, string> = {}; skip();
  if (text[index] === "}") index++;
  else while (index < text.length) {
    const key = string(); if (isError(key)) return key;
    if (Object.hasOwn(fields, key)) return err("review-duplicate", `review state contains duplicate field: ${key}`);
    skip(); if (text[index++] !== ":") return err("review-json", "review state field is missing ':'");
    const value = string(); if (isError(value)) return value; fields[key] = value; skip();
    if (text[index] === ",") { index++; continue; }
    if (text[index] === "}") { index++; break; }
    return err("review-json", "review state fields must be comma separated");
  }
  skip(); if (index !== text.length) return err("review-json", "review state has trailing content");
  return fields;
}
export function isGeneratedPlanBasename(value: unknown): value is string {
  return typeof value === "string" && value.length > 3 && value.endsWith(".md") && !isAbsolute(value) && !value.includes("/") && !value.includes("\\") && value !== "." && value !== ".." && !RESERVED_PLAN_FILES.has(value);
}
export function parseReviewState(content: unknown, expectedWorkflow?: string): ModernReviewReceipt | ArtifactError {
  const fields = parseFlatStringJson(content); if (isError(fields)) return fields;
  const keys = ["workflow", "plan_file", "plan_hash", "approved_session_id", "approved_at", "status", "reviewer_session_id", "reviewed_at"];
  if (Object.keys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) || !isModernWorkflow(fields.workflow)
    || (expectedWorkflow !== undefined && fields.workflow !== expectedWorkflow) || !isGeneratedPlanBasename(fields.plan_file) || !HASH.test(fields.plan_hash)
    || !fields.approved_session_id.trim() || !strictUtc(fields.approved_at) || !["PENDING", "APPROVED", "ISSUES_FOUND"].includes(fields.status)) return err("review-schema", "combined review state has an invalid strict schema");
  if (fields.status === "PENDING") {
    if (fields.reviewer_session_id !== "" || fields.reviewed_at !== "") return err("review-schema", "PENDING review state must leave reviewer fields empty");
  } else {
    if (!fields.reviewer_session_id.trim() || !strictUtc(fields.reviewed_at)) return err("review-schema", "final review state requires strict reviewer identity and time");
    if (fields.reviewer_session_id === fields.approved_session_id) return err("session-separation", "approval and review sessions must differ");
    if (Date.parse(fields.reviewed_at) <= Date.parse(fields.approved_at)) return err("approval-chronology", "review must be strictly later than approval");
  }
  return fields as ModernReviewReceipt;
}

export type ArtifactReadOptions = { beforeOpen?: (path: string) => void; afterOpen?: (path: string) => void; noFollowFlag?: number; forcePathnameFallback?: boolean };
function sameArtifactIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
function sameArtifactState(left: BigIntStats, right: BigIntStats): boolean {
  return sameArtifactIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}
function positionalSnapshot(fd: number, length: number): Buffer | undefined {
  const bytes = Buffer.allocUnsafe(length);
  for (let offset = 0; offset < length;) {
    const count = readSync(fd, bytes, offset, length - offset, offset);
    if (count <= 0) return undefined;
    offset += count;
  }
  const extra = Buffer.allocUnsafe(1);
  return readSync(fd, extra, 0, 1, length) === 0 ? bytes : undefined;
}
function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(fromRoot);
}
function rejectSymlinkComponents(root: string, path: string): ArtifactError | undefined {
  const canonicalRoot = realpathSync(root); const fromRoot = relative(canonicalRoot, path);
  if (!contained(canonicalRoot, path) || isAbsolute(fromRoot)) return err("policy-path", "approval artifact path escapes the project root");
  let candidate = canonicalRoot;
  for (const segment of fromRoot.split(/[\\/]/)) {
    candidate = join(candidate, segment); const entry = lstatSync(candidate);
    if (entry.isSymbolicLink()) {
      try { if (!contained(canonicalRoot, realpathSync(candidate))) return err("policy-path", "approval artifact path escapes the project root"); } catch { return err("artifact-type", `approval artifact path contains a symbolic link: ${path}`); }
      return err("artifact-type", `approval artifact path contains a symbolic link: ${path}`);
    }
  }
  if (!lstatSync(path).isFile()) return err("artifact-type", `approval artifact is not a regular file: ${path}`);
  if (!contained(canonicalRoot, realpathSync(path))) return err("policy-path", "approval artifact path escapes the project root");
  return undefined;
}
function readArtifactSnapshot(root: string, path: string, code = "artifact-read", options: ArtifactReadOptions = {}): Buffer | ArtifactError {
  let fd: number | undefined;
  try {
    const canonicalRoot = realpathSync(root);
    const unsafe = rejectSymlinkComponents(canonicalRoot, path); if (unsafe) return unsafe;
    options.beforeOpen?.(path);
    const changed = rejectSymlinkComponents(canonicalRoot, path); if (changed) return changed;
    const noFollow = options.noFollowFlag ?? constants.O_NOFOLLOW;
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) return err("artifact-type", `approval artifact is not a regular file: ${path}`);
    options.afterOpen?.(path);

    if (process.platform === "linux" && !options.forcePathnameFallback) {
      const openedPath = realpathSync(`/proc/self/fd/${fd}`);
      if (!contained(canonicalRoot, openedPath)) return err("policy-path", "approval artifact path escapes the project root");
    } else {
      const livePath = realpathSync(path);
      if (!contained(canonicalRoot, livePath)) return err("policy-path", "approval artifact path escapes the project root");
    }

    const current = rejectSymlinkComponents(canonicalRoot, path); if (current) return current;
    const leaf = lstatSync(path, { bigint: true });
    const afterOpen = fstatSync(fd, { bigint: true });
    if (!leaf.isFile() || !sameArtifactIdentity(leaf, opened) || !sameArtifactState(opened, afterOpen)) return err("approval-race", `approval artifact changed while opening: ${path}`);

    const bytes = readFileSync(fd);
    const afterRead = fstatSync(fd, { bigint: true });
    if (BigInt(bytes.length) !== opened.size || !sameArtifactState(opened, afterRead)) return err("approval-race", `approval artifact changed while reading: ${path}`);
    const repeated = positionalSnapshot(fd, bytes.length);
    const afterRepeat = fstatSync(fd, { bigint: true });
    if (!repeated || !repeated.equals(bytes) || !sameArtifactState(opened, afterRepeat)) return err("approval-race", `approval artifact changed while reading: ${path}`);

    const finalPath = rejectSymlinkComponents(canonicalRoot, path); if (finalPath) return finalPath;
    const final = lstatSync(path, { bigint: true });
    if (!final.isFile() || !sameArtifactState(opened, final)) return err("approval-race", `approval artifact changed while reading: ${path}`);
    return bytes;
  } catch { return err(code, `cannot read approval artifact: ${path}`); }
  finally { if (fd !== undefined) closeSync(fd); }
}
function readJsonSnapshot(value: Buffer | ArtifactError, path: string): unknown | ArtifactError {
  if (isError(value)) return value; try { return JSON.parse(value.toString("utf8")); } catch { return err("metadata-read", `cannot parse ${path}`); }
}

export function classifyBuiltInArtifactLayout(projectDir: string, workflow: WorkflowName): BuiltInArtifactLayout {
  const root = realpathSync(projectDir); const planning = join(root, ".planning");
  const receipt = join(planning, ".state", "review.json"); const legacyPlan = join(planning, "PLAN.md"); const legacyMetadata = join(planning, "PLAN.meta.json"); const legacyVerdict = join(planning, "PLAN_REVIEWED.md");
  if (!existsSync(receipt)) return existsSync(legacyPlan) || existsSync(legacyMetadata) || existsSync(legacyVerdict) ? "legacy" : "canonical";
  if (existsSync(legacyPlan) && existsSync(legacyMetadata) && existsSync(legacyVerdict)) {
    try {
      const hash = sha256(readFileSync(legacyPlan)); const metadata = parseMetadata(JSON.parse(readFileSync(legacyMetadata, "utf8")), workflow); const verdict = parseVerdict(readFileSync(legacyVerdict, "utf8"));
      if (!isError(metadata) && !isError(verdict) && metadata.planHash === hash && verdict.plan_hash === hash && verdict.status === "APPROVED") return "conflict";
    } catch { /* malformed legacy state is provenance */ }
  }
  return existsSync(legacyPlan) || existsSync(legacyMetadata) || existsSync(legacyVerdict) ? "canonical-with-legacy-provenance" : "canonical";
}

export function resolveGeneratedPlanReviewState(projectDir: string, expectedWorkflow?: string, readOptions: ArtifactReadOptions = {}): ResolvedGeneratedPlan | ArtifactError {
  let root: string; try { root = realpathSync(projectDir); } catch { return err("project-root", "project root must exist and be accessible"); }
  const statePath = join(root, ".planning", ".state", "review.json"); if (!existsSync(statePath)) return err("missing-artifact", ".planning/.state/review.json is required");
  const stateSnapshot = readArtifactSnapshot(root, statePath, "review-read", readOptions); if (isError(stateSnapshot)) return stateSnapshot;
  const receipt = parseReviewState(stateSnapshot.toString("utf8"), expectedWorkflow); if (isError(receipt)) return receipt;
  const planPath = join(root, ".planning", receipt.plan_file); if (!existsSync(planPath)) return err("missing-artifact", `selected generated plan is missing: ${receipt.plan_file}`);
  const planSnapshot = readArtifactSnapshot(root, planPath, "artifact-read", readOptions); if (isError(planSnapshot)) return planSnapshot;
  if (planSnapshot.length === 0) return err("empty-plan", `selected generated plan is empty: ${receipt.plan_file}`);
  const hash = sha256(planSnapshot); if (receipt.plan_hash !== hash) return err("stale-receipt", `review state does not authenticate current ${receipt.plan_file} bytes`);
  return { planFile: receipt.plan_file, planPath, hash, receipt };
}

/**
 * One fail-closed routing decision for lifecycle hooks. A visible planning ledger is never
 * authority for built-ins: only a receipt that authenticates its selected plan is.
 */
const CLARIFICATION_SENTINELS = new Set([
  "DS_CLARIFIED.json", "DEV_CLARIFIED.json", "WORK_CLARIFIED.json",
  "WRITING_CLARIFIED.json", "WORKSHOP_CLARIFIED.json", "WC_CLARIFIED.json",
]);
function hasOnlyBenignPreplanSentinel(planning: string): boolean {
  try {
    const entries = readdirSync(planning, { withFileTypes: true });
    const sentinel = entries.filter(entry => entry.isFile() && !entry.isSymbolicLink() && CLARIFICATION_SENTINELS.has(entry.name));
    const permitted = entries.every(entry =>
      (entry.isFile() && !entry.isSymbolicLink() && CLARIFICATION_SENTINELS.has(entry.name))
      || (entry.isDirectory() && !entry.isSymbolicLink() && entry.name === ".state"));
    if (!permitted || sentinel.length !== 1) return false;
    const state = join(planning, ".state");
    if (entries.some(entry => entry.name === ".state") && readdirSync(state).length !== 0) return false;
    const value = JSON.parse(readFileSync(join(planning, sentinel[0].name), "utf8"));
    return !!value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === 2 && value.status === "clarified"
      && typeof value.sessionId === "string" && value.sessionId.trim() !== "";
  } catch { return false; }
}
export function classifyPlanningLifecycle(projectDir: string): PlanningLifecycle {
  let root: string;
  try { root = realpathSync(projectDir); } catch { return { kind: "none" }; }
  const planning = join(root, ".planning");
  if (!existsSync(planning)) return { kind: "none" };
  const receiptPath = join(planning, ".state", "review.json");
  const resolved = resolveGeneratedPlanReviewState(root);
  if (!isError(resolved)) return { kind: "canonical", resolved };
  if (existsSync(receiptPath)) return { kind: "blocked", reason: resolved.code };
  if (hasOnlyBenignPreplanSentinel(planning)) return { kind: "none" };
  try {
    if (readdirSync(planning).length > 0) return { kind: "blocked", reason: "conversion-required" };
  } catch { return { kind: "blocked", reason: "planning-read" }; }
  return { kind: "none" };
}

export function parseApprovalPolicyDescriptor(value: unknown, workflow: string): ApprovalPolicyDescriptor | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("policy-schema", "approval policy must be an object");
  const policy = value as Record<string, unknown>; const keys = ["schemaVersion", "workflow", "planPath", "metadataPath", "verdictPath"];
  if (Object.keys(policy).length !== keys.length || keys.some(key => !Object.hasOwn(policy, key)) || policy.schemaVersion !== 1 || typeof policy.workflow !== "string" || !policy.workflow.trim() || typeof policy.planPath !== "string" || typeof policy.metadataPath !== "string" || typeof policy.verdictPath !== "string") return err("policy-schema", "approval policy has an invalid strict schema");
  if (policy.workflow !== workflow) return err("policy-workflow-mismatch", `approval policy authorizes ${policy.workflow}, not ${workflow}`); return policy as ApprovalPolicyDescriptor;
}
function resolvePolicyPath(projectDir: string, value: string): string | ArtifactError {
  if (!value || isAbsolute(value) || value.includes("\\")) return err("policy-path", "approval artifact paths must be project-relative");
  if (value.split("/").some(segment => !segment || segment === "." || segment === "..")) return err("policy-path", "approval artifact paths must be canonical project-relative paths");
  const root = realpathSync(projectDir); const candidate = join(root, value); if (!existsSync(candidate)) return err("missing-artifact", `required approval artifact is missing: ${value}`);
  try { const unsafe = rejectSymlinkComponents(root, candidate); if (unsafe) return unsafe; } catch { return err("missing-artifact", `required approval artifact is missing: ${value}`); }
  return candidate;
}

export function validateApprovedPlan(projectDir: string, workflow: string, descriptor?: ApprovalPolicyDescriptor, readOptions: ArtifactReadOptions = {}): AuthenticatedPlan | ArtifactError {
  let root: string; try { root = realpathSync(projectDir); } catch { return err("project-root", "project root must exist and be accessible"); }
  if (descriptor !== undefined && isBuiltInWorkflow(workflow)) return err("policy-ambiguous", "built-in workflows cannot override approval artifact paths");
  if (descriptor === undefined && !isBuiltInWorkflow(workflow)) return err("unknown-workflow", "external workflows require an explicit approval policy");
  if (descriptor === undefined && isModernWorkflow(workflow)) {
    const layout = classifyBuiltInArtifactLayout(root, workflow); if (layout === "conflict") return err("artifact-layout-conflict", "generated and legacy approval artifacts contain competing current authority");
    if (layout === "legacy") return err("conversion-required", `legacy ${workflow} approval artifacts are conversion input only; create a fresh generated plan`);
    const resolved = resolveGeneratedPlanReviewState(root, workflow, readOptions); if (isError(resolved)) return resolved;
    const metadata: ApprovalMetadata = { schemaVersion: 1, workflow, planHash: resolved.hash, approvedSession: resolved.receipt.approved_session_id, approvedAt: resolved.receipt.approved_at };
    return { hash: resolved.hash, planFile: resolved.planFile, planPath: resolved.planPath, receipt: resolved.receipt, metadata, layout };
  }
  const policy = parseApprovalPolicyDescriptor(descriptor, workflow); if (isError(policy)) return policy;
  const planPath = resolvePolicyPath(root, policy.planPath); if (isError(planPath)) return planPath;
  const metadataPath = resolvePolicyPath(root, policy.metadataPath); if (isError(metadataPath)) return metadataPath;
  if (new Set([policy.planPath, policy.metadataPath, policy.verdictPath]).size !== 3) return err("policy-path", "approval artifact paths must identify distinct files");
  const planSnapshot = readArtifactSnapshot(root, planPath, "artifact-read", readOptions); if (isError(planSnapshot)) return planSnapshot;
  const metadataValue = readJsonSnapshot(readArtifactSnapshot(root, metadataPath, "metadata-read", readOptions), metadataPath); if (isError(metadataValue)) return metadataValue;
  const metadata = parseMetadata(metadataValue, workflow); if (isError(metadata)) return metadata;
  const hash = sha256(planSnapshot); if (metadata.planHash !== hash) return err("stale-metadata", "PLAN metadata does not authenticate current bytes");
  return { hash, metadata, layout: "external" };
}

export function validateApprovedArtifact(projectDir: string, workflow: string, currentSession: unknown, descriptor?: ApprovalPolicyDescriptor, readOptions: ArtifactReadOptions = {}): ApprovedArtifact | ArtifactError {
  let root: string; try { root = realpathSync(projectDir); } catch { return err("project-root", "project root must exist and be accessible"); }
  if (descriptor !== undefined && isBuiltInWorkflow(workflow)) return err("policy-ambiguous", "built-in workflows cannot override approval artifact paths");
  if (descriptor === undefined && !isBuiltInWorkflow(workflow)) return err("unknown-workflow", "external workflows require an explicit approval policy");
  if (descriptor === undefined && isModernWorkflow(workflow)) {
    const first = validateApprovedPlan(root, workflow, undefined, readOptions); if (isError(first)) return first;
    if (!first.receipt || !first.planFile || !first.planPath) return err("review-schema", "generated plan approval state is incomplete");
    if (first.receipt.status !== "APPROVED") return err("review-pending", `review state is ${first.receipt.status}, not APPROVED`);
    const actor = parseActorIdentity(currentSession); if (isError(actor)) return actor;
    const separation = actorSeparation(first.receipt.approved_session_id, first.receipt.reviewer_session_id, actor); if (separation) return separation;
    const second = validateApprovedPlan(root, workflow, undefined, readOptions); if (isError(second)) return second;
    if (!second.receipt || second.hash !== first.hash || JSON.stringify(second.receipt) !== JSON.stringify(first.receipt)) return err("approval-race", "generated plan approval state changed during validation");
    return { hash: first.hash, planFile: first.planFile, planPath: first.planPath, receipt: first.receipt, metadata: first.metadata, verdict: { plan_hash: first.hash, status: "APPROVED", reviewer_session_id: first.receipt.reviewer_session_id, reviewed_at: first.receipt.reviewed_at } };
  }
  const authenticated = validateApprovedPlan(root, workflow, descriptor, readOptions); if (isError(authenticated)) return authenticated;
  const policy = parseApprovalPolicyDescriptor(descriptor, workflow); if (isError(policy)) return policy;
  const verdictPath = resolvePolicyPath(root, policy.verdictPath); if (isError(verdictPath)) return verdictPath;
  const verdictBytes = readArtifactSnapshot(root, verdictPath, "verdict-read", readOptions); if (isError(verdictBytes)) return verdictBytes;
  const verdict = parseVerdict(verdictBytes.toString("utf8")); if (isError(verdict)) return verdict;
  if (verdict.status !== "APPROVED" || verdict.plan_hash !== authenticated.hash) return err("stale-verdict", "review verdict is not APPROVED for current plan bytes");
  const externalActor = parseActorIdentity(currentSession); if (isError(externalActor)) return externalActor;
  const externalSeparation = actorSeparation(authenticated.metadata.approvedSession, verdict.reviewer_session_id, externalActor); if (externalSeparation) return externalSeparation;
  if (Date.parse(verdict.reviewed_at) <= Date.parse(authenticated.metadata.approvedAt)) return err("approval-chronology", "review must be strictly later than approval");
  return { hash: authenticated.hash, metadata: authenticated.metadata, verdict };
}

type OwnedDirectory = { fd: number; stat: BigIntStats; anchor?: string };
function descriptorDirectoryAnchor(fd: number, stat: BigIntStats, forceNoDescriptorAnchor: boolean): string | undefined {
  if (forceNoDescriptorAnchor) return undefined;
  const descriptorPath = process.platform === "linux" ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
  const anchor = `${descriptorPath}/.`;
  const flags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);
  let checkFd: number | undefined;
  try {
    checkFd = openSync(anchor, flags);
    const anchored = fstatSync(checkFd, { bigint: true });
    return anchored.isDirectory() && sameArtifactIdentity(stat, anchored) ? anchor : undefined;
  } catch { return undefined; }
  finally { if (checkFd !== undefined) closeSync(checkFd); }
}
function openOwnedDirectory(root: string, path: string, forceNoDescriptorAnchor = false): OwnedDirectory {
  const flags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags);
  try {
    const stat = fstatSync(fd, { bigint: true });
    const leaf = lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || !leaf.isDirectory() || leaf.isSymbolicLink() || !sameArtifactIdentity(stat, leaf)) throw new Error(`approval artifact directory changed while opening: ${path}`);
    if (!contained(root, realpathSync(path))) throw new Error(`approval artifact directory escapes the project root: ${path}`);
    return { fd, stat, anchor: descriptorDirectoryAnchor(fd, stat, forceNoDescriptorAnchor) };
  } catch (error) { closeSync(fd); throw error; }
}
function liveDirectoryMatches(root: string, path: string, expected: BigIntStats): boolean {
  try {
    const live = lstatSync(path, { bigint: true });
    return live.isDirectory() && !live.isSymbolicLink() && sameArtifactIdentity(live, expected) && contained(root, realpathSync(path));
  } catch { return false; }
}
function requireLiveDirectory(root: string, path: string, directory: OwnedDirectory): void {
  if (!liveDirectoryMatches(root, path, directory.stat)) throw new Error("approval artifact directories changed while binding generated plan");
}
export function atomicWrite(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`; let fd: number | undefined;
  try { fd = openSync(temporary, "wx", 0o600); const bytes = Buffer.from(content, "utf8"); for (let offset = 0; offset < bytes.length;) { const written = writeSync(fd, bytes, offset, bytes.length - offset); if (written <= 0) throw new Error("write made no progress"); offset += written; } fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, path); }
  finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch {} }
}
function atomicWriteOwnedDirectory(root: string, livePath: string, directory: OwnedDirectory, basename: string, content: string, afterTemporaryOpen?: () => void): void {
  if (directory.anchor === undefined) throw new Error("approval artifact directory does not support descriptor-anchored mutation");
  const base = directory.anchor;
  const target = join(base, basename);
  const temporary = join(base, `${basename}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const bytes = Buffer.from(content, "utf8");
  let fd: number | undefined;
  try {
    requireLiveDirectory(root, livePath, directory);
    fd = openSync(temporary, "wx", 0o600);
    afterTemporaryOpen?.();
    requireLiveDirectory(root, livePath, directory);
    for (let offset = 0; offset < bytes.length;) {
      requireLiveDirectory(root, livePath, directory);
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      requireLiveDirectory(root, livePath, directory);
      if (written <= 0) throw new Error("write made no progress");
      offset += written;
    }
    fsyncSync(fd); closeSync(fd); fd = undefined;
    requireLiveDirectory(root, livePath, directory);
    renameSync(temporary, target);
    requireLiveDirectory(root, livePath, directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
}
function unlinkOwnedDirectory(root: string, livePath: string, directory: OwnedDirectory, basename: string): void {
  if (directory.anchor === undefined) throw new Error("approval artifact directory does not support descriptor-anchored mutation");
  const target = join(directory.anchor, basename);
  requireLiveDirectory(root, livePath, directory);
  try { unlinkSync(target); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  requireLiveDirectory(root, livePath, directory);
}
export type ArtifactWriteOptions = { forceNoDescriptorAnchor?: boolean; afterStateOpen?: (strategy: "descriptor" | "pathname") => void; afterTemporaryOpen?: () => void };
export function bindApprovedGeneratedPlan(projectDir: string, workflow: BuiltInApprovalWorkflow, absolutePlanPath: string, session: string, approvedAt = new Date().toISOString(), options: ArtifactWriteOptions = {}): ModernReviewReceipt {
  if (!MODERN_WORKFLOWS.has(workflow) || !session.trim() || !strictUtc(approvedAt)) throw new Error("approval binding identity is invalid");
  const root = realpathSync(projectDir); const planning = join(root, ".planning"); const state = join(planning, ".state");
  if (!isAbsolute(absolutePlanPath)) throw new Error("generated plan path must be absolute"); const basename = relative(planning, absolutePlanPath);
  if (!isGeneratedPlanBasename(basename) || join(planning, basename) !== absolutePlanPath) throw new Error("generated plan must be a safe direct child of project .planning");

  let planningDirectory: ReturnType<typeof openOwnedDirectory> | undefined;
  let stateDirectory: ReturnType<typeof openOwnedDirectory> | undefined;
  try {
    planningDirectory = openOwnedDirectory(root, planning, options.forceNoDescriptorAnchor);
    requireLiveDirectory(root, planning, planningDirectory);
    if (planningDirectory.anchor === undefined) {
      if (!existsSync(state)) throw new Error("approval artifact directory does not support descriptor-anchored mutation");
      stateDirectory = openOwnedDirectory(root, state, true);
      requireLiveDirectory(root, state, stateDirectory);
      options.afterStateOpen?.("pathname");
      throw new Error("approval artifact directory does not support descriptor-anchored mutation");
    }
    const anchoredState = join(planningDirectory.anchor, ".state");
    if (!existsSync(anchoredState)) mkdirSync(anchoredState);
    else {
      const stateEntry = lstatSync(anchoredState);
      if (stateEntry.isSymbolicLink() || !stateEntry.isDirectory()) throw new Error(`approval artifact directory must be a real directory: ${state}`);
    }
    stateDirectory = openOwnedDirectory(root, anchoredState, options.forceNoDescriptorAnchor);
    requireLiveDirectory(root, planning, planningDirectory); requireLiveDirectory(root, state, stateDirectory);
    const snapshot = readArtifactSnapshot(root, absolutePlanPath); if (isError(snapshot)) throw new Error(snapshot.message); if (snapshot.length === 0) throw new Error("generated plan must be nonempty");
    new TextDecoder("utf-8", { fatal: true }).decode(snapshot);
    requireLiveDirectory(root, planning, planningDirectory); requireLiveDirectory(root, state, stateDirectory);
    const receipt: ModernReviewReceipt = { workflow, plan_file: basename, plan_hash: sha256(snapshot), approved_session_id: session, approved_at: approvedAt, status: "PENDING", reviewer_session_id: "", reviewed_at: "" };
    options.afterStateOpen?.(stateDirectory.anchor === undefined ? "pathname" : "descriptor");
    if (stateDirectory.anchor === undefined) throw new Error("approval artifact directory does not support descriptor-anchored mutation");
    requireLiveDirectory(root, planning, planningDirectory); requireLiveDirectory(root, state, stateDirectory);
    atomicWriteOwnedDirectory(root, state, stateDirectory, "review.json", `${JSON.stringify(receipt, null, 2)}\n`, options.afterTemporaryOpen);
    requireLiveDirectory(root, planning, planningDirectory); requireLiveDirectory(root, state, stateDirectory);
    unlinkOwnedDirectory(root, state, stateDirectory, "plan.json");
    requireLiveDirectory(root, planning, planningDirectory); requireLiveDirectory(root, state, stateDirectory);
    return receipt;
  } finally {
    if (stateDirectory !== undefined) closeSync(stateDirectory.fd);
    if (planningDirectory !== undefined) closeSync(planningDirectory.fd);
  }
}

/**
 * `implementationSession` is the identity of the actor the binding speaks for, and
 * `implementationRole` says what that actor claims to be. Omitting the role means `implement`, so a
 * binding that has not thought about the distinction is held to the strict three-way rule.
 *
 * A shared runner that hands each task to a fresh `agent()` subagent is a `dispatch` actor: the
 * subagents it creates are the implementers and their identities do not exist yet.
 */
export type ImplementationApprovalBindingV1 = Readonly<{ taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string; implementationSession: string; implementationRole?: ActorRole }>;
export type BuiltInImplementationApprovalV2 = Readonly<{ schemaVersion: 2; approvalBundleDigest: string; planFile: string; planHash: string; workflow: BuiltInApprovalWorkflow; taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string; approvalSession: string; reviewerSession: string; implementationSession: string; approvedAt: string; reviewedAt: string; terminalReleaseAuthorized: false }>;
export type CapturedImplementationApprovalV1 = Readonly<{ schemaVersion: 1; approvalBundleDigest: string; planDigest: string; workflow: string; taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string; approvalSession: string; reviewerSession: string; implementationSession: string; approvedAt: string; reviewedAt: string; terminalReleaseAuthorized: false }>;
export function validateBuiltInImplementationApproval(artifact: ApprovedArtifact, expectedWorkflow: string, binding: ImplementationApprovalBindingV1): BuiltInImplementationApprovalV2 | ArtifactError {
  if (!isModernWorkflow(expectedWorkflow) || !artifact.receipt || !artifact.planFile || artifact.receipt.workflow !== expectedWorkflow || artifact.receipt.plan_file !== artifact.planFile) return err("workflow-mismatch", "built-in generated-plan approval workflow was substituted");
  if (!binding.taskIdentity.trim() || !HASH.test(binding.taskContractDigest) || !HASH.test(binding.preDispatchObservationDigest)) return err("binding-schema", "implementation approval binding is invalid");
  // TYPE GUARD, NOT A TRUTHINESS CHECK. `binding.implementationSession.trim()` threw an uncaught
  // TypeError out of the Workflow runtime whenever the caller passed an absent identity — a crash
  // where a controlled denial belonged. parseActorIdentity rejects every non-string.
  const actor = parseActorIdentity(binding.implementationRole === undefined ? binding.implementationSession : { role: binding.implementationRole, identity: binding.implementationSession });
  if (isError(actor)) return actor;
  const separation = actorSeparation(artifact.receipt.approved_session_id, artifact.receipt.reviewer_session_id, actor); if (separation) return separation;
  const approvalBundleDigest = sha256(Buffer.from(JSON.stringify({ schemaVersion: 2, planFile: artifact.planFile, planHash: artifact.hash, workflow: expectedWorkflow, taskIdentity: binding.taskIdentity, taskContractDigest: binding.taskContractDigest, preDispatchObservationDigest: binding.preDispatchObservationDigest, approvalSession: artifact.receipt.approved_session_id, reviewerSession: artifact.receipt.reviewer_session_id, implementationSession: binding.implementationSession }), "utf8"));
  return Object.freeze({ schemaVersion: 2, approvalBundleDigest, planFile: artifact.planFile, planHash: artifact.hash, workflow: expectedWorkflow, taskIdentity: binding.taskIdentity, taskContractDigest: binding.taskContractDigest, preDispatchObservationDigest: binding.preDispatchObservationDigest, approvalSession: artifact.receipt.approved_session_id, reviewerSession: artifact.receipt.reviewer_session_id, implementationSession: binding.implementationSession, approvedAt: artifact.receipt.approved_at, reviewedAt: artifact.receipt.reviewed_at, terminalReleaseAuthorized: false });
}
export function validateExternalImplementationApproval(artifact: ApprovedArtifact, expectedWorkflow: string, binding: ImplementationApprovalBindingV1): CapturedImplementationApprovalV1 | ArtifactError {
  if (!artifact.metadata || artifact.metadata.workflow !== expectedWorkflow) return err("workflow-mismatch", "external approval workflow was substituted");
  if (!binding.taskIdentity.trim() || !HASH.test(binding.taskContractDigest) || !HASH.test(binding.preDispatchObservationDigest)) return err("binding-schema", "implementation approval binding is invalid");
  const externalActor = parseActorIdentity(binding.implementationRole === undefined ? binding.implementationSession : { role: binding.implementationRole, identity: binding.implementationSession });
  if (isError(externalActor)) return externalActor;
  const externalSeparation = actorSeparation(artifact.metadata.approvedSession, artifact.verdict.reviewer_session_id, externalActor); if (externalSeparation) return externalSeparation;
  const approvalBundleDigest = sha256(Buffer.from(JSON.stringify({ schemaVersion: 1, planDigest: artifact.hash, workflow: expectedWorkflow, taskIdentity: binding.taskIdentity, taskContractDigest: binding.taskContractDigest, preDispatchObservationDigest: binding.preDispatchObservationDigest, approvalSession: artifact.metadata.approvedSession, reviewerSession: artifact.verdict.reviewer_session_id, implementationSession: binding.implementationSession }), "utf8"));
  return Object.freeze({ schemaVersion: 1, approvalBundleDigest, planDigest: artifact.hash, workflow: expectedWorkflow, taskIdentity: binding.taskIdentity, taskContractDigest: binding.taskContractDigest, preDispatchObservationDigest: binding.preDispatchObservationDigest, approvalSession: artifact.metadata.approvedSession, reviewerSession: artifact.verdict.reviewer_session_id, implementationSession: binding.implementationSession, approvedAt: artifact.metadata.approvedAt, reviewedAt: artifact.verdict.reviewed_at, terminalReleaseAuthorized: false });
}

type CapturedApprovalMetadataV1 = ApprovalMetadata & Readonly<{ taskIdentity: string; taskContractDigest: string; preDispatchObservationDigest: string }>;
import { copyCapturedApprovalBundle, digestBytes, type CapturedApprovalBundleV1 } from "./approval-bundle.ts";
function parseCapturedApprovalMetadata(value: unknown, expectedWorkflow: string): CapturedApprovalMetadataV1 | ArtifactError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return err("metadata-shape", "PLAN metadata must be an object");
  const metadata = value as Record<string, unknown>; const keys = ["schemaVersion", "workflow", "planHash", "approvedSession", "approvedAt", "taskIdentity", "taskContractDigest", "preDispatchObservationDigest"];
  if (Object.keys(metadata).length !== keys.length || keys.some(key => !Object.hasOwn(metadata, key)) || metadata.schemaVersion !== 1 || metadata.workflow !== expectedWorkflow || typeof metadata.planHash !== "string" || !HASH.test(metadata.planHash) || typeof metadata.approvedSession !== "string" || !metadata.approvedSession.trim() || !strictUtc(metadata.approvedAt) || typeof metadata.taskIdentity !== "string" || !metadata.taskIdentity.trim() || typeof metadata.taskContractDigest !== "string" || !HASH.test(metadata.taskContractDigest) || typeof metadata.preDispatchObservationDigest !== "string" || !HASH.test(metadata.preDispatchObservationDigest)) return err("metadata-schema", "captured approval metadata has an invalid strict schema");
  return metadata as CapturedApprovalMetadataV1;
}
export function validateCapturedApprovalBundle(bundle: CapturedApprovalBundleV1, expectedWorkflow: string, binding: ImplementationApprovalBindingV1): CapturedImplementationApprovalV1 | ArtifactError {
  if (!bundle || bundle.schemaVersion !== 1) return err("bundle-schema", "approval bundle has an invalid schema"); const snapshot = copyCapturedApprovalBundle(bundle); let descriptor: unknown; let metadataValue: unknown;
  try { descriptor = JSON.parse(snapshot.descriptorBytes.toString("utf8")); metadataValue = JSON.parse(snapshot.metadataBytes.toString("utf8")); } catch { return err("bundle-schema", "approval bundle contains malformed JSON"); }
  const policy = parseApprovalPolicyDescriptor(descriptor, expectedWorkflow); if (isError(policy)) return policy; const metadata = parseCapturedApprovalMetadata(metadataValue, expectedWorkflow); if (isError(metadata)) return metadata; const verdict = parseVerdict(Buffer.from(snapshot.verdictBytes).toString("utf8")); if (isError(verdict)) return verdict; const planDigest = digestBytes(snapshot.planBytes);
  if (metadata.planHash !== planDigest || verdict.plan_hash !== planDigest || verdict.status !== "APPROVED") return err("stale-approval", "approval does not authenticate captured plan bytes");
  if (!binding.taskIdentity.trim() || !HASH.test(binding.taskContractDigest) || !HASH.test(binding.preDispatchObservationDigest)) return err("binding-schema", "implementation approval binding is invalid");
  for (const [key, expected] of [["taskIdentity", binding.taskIdentity], ["taskContractDigest", binding.taskContractDigest], ["preDispatchObservationDigest", binding.preDispatchObservationDigest]] as const) if (metadata[key] !== expected) return err("binding-mismatch", `${key} was substituted`);
  const capturedActor = parseActorIdentity(binding.implementationRole === undefined ? binding.implementationSession : { role: binding.implementationRole, identity: binding.implementationSession });
  if (isError(capturedActor)) return capturedActor;
  const capturedSeparation = actorSeparation(metadata.approvedSession, verdict.reviewer_session_id, capturedActor); if (capturedSeparation) return capturedSeparation;
  if (Date.parse(verdict.reviewed_at) <= Date.parse(metadata.approvedAt)) return err("approval-chronology", "review must be strictly later than approval");
  const all = Buffer.concat([Buffer.from(snapshot.descriptorBytes), Buffer.from(snapshot.planBytes), Buffer.from(snapshot.metadataBytes), Buffer.from(snapshot.verdictBytes)]);
  return Object.freeze({ schemaVersion: 1, approvalBundleDigest: digestBytes(all), planDigest, workflow: expectedWorkflow, taskIdentity: metadata.taskIdentity, taskContractDigest: metadata.taskContractDigest, preDispatchObservationDigest: metadata.preDispatchObservationDigest, approvalSession: metadata.approvedSession, reviewerSession: verdict.reviewer_session_id, implementationSession: binding.implementationSession, approvedAt: metadata.approvedAt, reviewedAt: verdict.reviewed_at, terminalReleaseAuthorized: false });
}
