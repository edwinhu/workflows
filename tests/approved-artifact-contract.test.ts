import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindApprovedGeneratedPlan,
  classifyBuiltInArtifactLayout,
  classifyPlanningLifecycle,
  hookActorIdentity,
  isSubagentPayload,
  sha256,
  validateApprovedArtifact,
  validateApprovedPlan,
  validateBuiltInImplementationApproval,
  validateCapturedApprovalBundle,
  type ApprovalPolicyDescriptor,
  type ApprovedArtifact,
} from "../workflows/lib/approved-artifact";
import { captureApprovalBundle, type CapturedApprovalBundleV1 } from "../workflows/lib/approval-bundle";

const IDENTITY = "opaque-extension-7f3a";
const DESCRIPTOR: ApprovalPolicyDescriptor = {
  schemaVersion: 1,
  workflow: IDENTITY,
  planPath: ".approval/CURRENT.md",
  metadataPath: ".approval/CURRENT.meta.json",
  verdictPath: ".approval/CURRENT_REVIEWED.md",
};

function withProject(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "approved-artifact-contract-"));
  try { run(realpathSync(root)); } finally { rmSync(root, { recursive: true, force: true }); }
}

function writeApproved(root: string, overrides: {
  plan?: string;
  metadata?: Record<string, unknown>;
  verdict?: Record<string, unknown>;
} = {}): void {
  const plan = overrides.plan ?? "# Exact current bytes\n";
  const hash = sha256(plan);
  mkdirSync(join(root, ".approval"), { recursive: true });
  writeFileSync(join(root, DESCRIPTOR.planPath), plan);
  writeFileSync(join(root, DESCRIPTOR.metadataPath), `${JSON.stringify(overrides.metadata ?? {
    schemaVersion: 1,
    workflow: IDENTITY,
    planHash: hash,
    approvedSession: "approval-session",
    approvedAt: "2026-07-30T10:00:00.000Z",
  }, null, 2)}\n`);
  const verdict = overrides.verdict ?? {
    plan_hash: hash,
    status: "APPROVED",
    reviewer_session_id: "review-session",
    reviewed_at: "2026-07-30T11:00:00.000Z",
  };
  writeFileSync(join(root, DESCRIPTOR.verdictPath), `---\n${Object.entries(verdict).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`);
}

function expectError(value: ReturnType<typeof validateApprovedArtifact>, code: string): void {
  expect(value).toEqual(expect.objectContaining({ code }));
}

describe("strict external approved-artifact policy", () => {
  test("authenticates an opaque extension identity against current bytes", () => withProject((root) => {
    writeApproved(root);
    const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR);
    expect(result).toEqual(expect.objectContaining({
      hash: sha256("# Exact current bytes\n"),
      metadata: expect.objectContaining({ workflow: IDENTITY }),
      verdict: expect.objectContaining({ status: "APPROVED" }),
    }));
  }));

  test("authenticates external plan metadata without requiring its review artifact", () => withProject((root) => {
    writeApproved(root);
    rmSync(join(root, DESCRIPTOR.verdictPath));
    expect(validateApprovedPlan(root, IDENTITY, DESCRIPTOR)).toEqual(expect.objectContaining({
      hash: sha256("# Exact current bytes\n"),
      layout: "external",
      metadata: expect.objectContaining({ workflow: IDENTITY }),
    }));
  }));

  test("rejects unknown identities without an explicit descriptor", () => withProject((root) => {
    writeApproved(root);
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session"), "unknown-workflow");
  }));

  /**
   * The rule under test is `binding-mismatch`: captured metadata whose taskIdentity /
   * taskContractDigest / preDispatchObservationDigest do not equal the ones the caller binds.
   *
   * This asserted `code: expect.any(String)` — i.e. ANY error at all — under a title naming the
   * binding rule, while the fixture used `writeApproved`'s DEFAULT metadata, which omits all three
   * binding fields and therefore dies at `metadata-schema` before the binding comparison is ever
   * reached. The named rule was never exercised. Fixed on both sides: the fixture now carries a
   * schema-complete captured metadata block so validation reaches the comparison, and the code is
   * pinned exactly. The schema path keeps its own case below, where it belongs.
   */
  test("captured approval rejects artifacts that do not bind the named task and pre-dispatch state", () => withProject((root) => {
    const plan = "# Exact current bytes\n";
    writeApproved(root, { metadata: {
      schemaVersion: 1,
      workflow: IDENTITY,
      planHash: sha256(plan),
      approvedSession: "approval-session",
      approvedAt: "2026-07-30T10:00:00.000Z",
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
    } });
    const captured = captureApprovalBundle(root, Buffer.from(JSON.stringify(DESCRIPTOR)), DESCRIPTOR);
    const binding = {
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
      implementationSession: "implementation-session",
    };
    // The fixture now VALIDATES, which is what makes the negative cases below meaningful.
    expect(validateCapturedApprovalBundle(captured, IDENTITY, binding))
      .toEqual(expect.objectContaining({ schemaVersion: 1, taskIdentity: "task-14" }));

    // One substituted binding field at a time; each must be caught by the binding rule itself.
    expectError(validateCapturedApprovalBundle(captured, IDENTITY, { ...binding, taskIdentity: "task-15" }), "binding-mismatch");
    expectError(validateCapturedApprovalBundle(captured, IDENTITY, { ...binding, taskContractDigest: "c".repeat(64) }), "binding-mismatch");
    expectError(validateCapturedApprovalBundle(captured, IDENTITY, { ...binding, preDispatchObservationDigest: "d".repeat(64) }), "binding-mismatch");
  }));

  test("captured approval rejects metadata that omits the binding fields entirely", () => withProject((root) => {
    writeApproved(root);
    const captured = captureApprovalBundle(root, Buffer.from(JSON.stringify(DESCRIPTOR)), DESCRIPTOR);
    expectError(validateCapturedApprovalBundle(captured, IDENTITY, {
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
      implementationSession: "implementation-session",
    }), "metadata-schema");
  }));

  test("pure captured validation authenticates the bytes captured before later path edits", () => withProject((root) => {
    writeApproved(root, { metadata: {
      schemaVersion: 1,
      workflow: IDENTITY,
      planHash: sha256("# Exact current bytes\n"),
      approvedSession: "approval-session",
      approvedAt: "2026-07-30T10:00:00.000Z",
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
    } });
    const captured = captureApprovalBundle(root, Buffer.from(JSON.stringify(DESCRIPTOR)), DESCRIPTOR);
    writeFileSync(join(root, DESCRIPTOR.planPath), "# replaced after capture\n");
    const result = validateCapturedApprovalBundle(captured, IDENTITY, {
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
      implementationSession: "implementation-session",
    });

    expect(result).toEqual(expect.objectContaining({ planDigest: sha256("# Exact current bytes\n") }));
  }));

  test("captured bytes are defensively owned and validation snapshots each accessor once", () => withProject((root) => {
    writeApproved(root, { metadata: {
      schemaVersion: 1,
      workflow: IDENTITY,
      planHash: sha256("# Exact current bytes\n"),
      approvedSession: "approval-session",
      approvedAt: "2026-07-30T10:00:00.000Z",
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
    } });
    const captured = captureApprovalBundle(root, Buffer.from(JSON.stringify(DESCRIPTOR)), DESCRIPTOR);
    captured.planBytes.fill(0);
    expect(captured.planBytes.toString("utf8")).toBe("# Exact current bytes\n");

    const reads = new Map<string, number>();
    const unstable = { schemaVersion: 1 } as CapturedApprovalBundleV1;
    for (const field of ["descriptorBytes", "planBytes", "metadataBytes", "verdictBytes"] as const) {
      Object.defineProperty(unstable, field, { get() {
        const count = (reads.get(field) ?? 0) + 1;
        reads.set(field, count);
        return count === 1 ? captured[field] : Buffer.from("substituted");
      } });
    }
    const result = validateCapturedApprovalBundle(unstable, IDENTITY, {
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
      implementationSession: "implementation-session",
    });
    expect(result).toEqual(expect.objectContaining({ planDigest: sha256("# Exact current bytes\n") }));
    expect(Object.fromEntries(reads)).toEqual({ descriptorBytes: 1, planBytes: 1, metadataBytes: 1, verdictBytes: 1 });
  }));

  test("capture rejects final and ancestor symlinks, including internal, external, and dangling targets", () => withProject((root) => {
    const outside = mkdtempSync(join(tmpdir(), "approval-capture-outside-"));
    try {
      for (const targetKind of ["internal", "external", "dangling"] as const) {
        writeApproved(root);
        const actual = join(root, `.approval-${targetKind}`);
        if (targetKind === "internal") symlinkSync(join(root, ".approval"), actual);
        else if (targetKind === "external") symlinkSync(outside, actual);
        else symlinkSync(join(outside, "missing"), actual);
        const locations = { ...DESCRIPTOR, planPath: `.approval-${targetKind}/CURRENT.md` };
        expect(() => captureApprovalBundle(root, Buffer.from(JSON.stringify(locations)), locations)).toThrow(/symbolic link/);
        rmSync(actual, { force: true });
      }

      const finalPath = join(root, DESCRIPTOR.planPath);
      for (const targetKind of ["internal", "external", "dangling"] as const) {
        rmSync(finalPath, { force: true });
        writeApproved(root);
        const target = targetKind === "internal" ? `${finalPath}.target` : join(outside, targetKind === "external" ? "PLAN.md" : "missing");
        if (targetKind !== "dangling") writeFileSync(target, readFileSync(finalPath));
        rmSync(finalPath);
        symlinkSync(target, finalPath);
        expect(() => captureApprovalBundle(root, Buffer.from(JSON.stringify(DESCRIPTOR)), DESCRIPTOR)).toThrow(/symbolic link/);
        rmSync(finalPath, { force: true });
        if (targetKind === "internal") rmSync(target, { force: true });
      }
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("capture authenticates descriptor-declared locations against supplied locations", () => withProject((root) => {
    writeApproved(root);
    const descriptorBytes = Buffer.from(JSON.stringify(DESCRIPTOR));
    expect(() => captureApprovalBundle(root, descriptorBytes, { ...DESCRIPTOR, planPath: DESCRIPTOR.metadataPath })).toThrow(/descriptor.*locations/);
    expect(() => captureApprovalBundle(root, Buffer.from(JSON.stringify({ ...DESCRIPTOR, verdictPath: DESCRIPTOR.planPath })), DESCRIPTOR)).toThrow(/descriptor.*locations/);
  }));

  test("rejects descriptor schema changes and identity mismatches", () => withProject((root) => {
    writeApproved(root);
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", { ...DESCRIPTOR, workflow: "other-opaque-id" }), "policy-workflow-mismatch");
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", { ...DESCRIPTOR, extra: true } as ApprovalPolicyDescriptor), "policy-schema");
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", { ...DESCRIPTOR, schemaVersion: 2 } as unknown as ApprovalPolicyDescriptor), "policy-schema");
  }));

  test("rejects absolute, traversal, and symlink-escaping policy paths", () => withProject((root) => {
    writeApproved(root);
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", { ...DESCRIPTOR, planPath: "/tmp/PLAN.md" }), "policy-path");
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", { ...DESCRIPTOR, planPath: "../PLAN.md" }), "policy-path");

    const outside = mkdtempSync(join(tmpdir(), "approved-artifact-outside-"));
    try {
      writeFileSync(join(outside, "PLAN.md"), "# outside\n");
      symlinkSync(outside, join(root, "escape"));
      expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", { ...DESCRIPTOR, planPath: "escape/PLAN.md" }), "policy-path");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("returns typed errors for non-regular approval artifacts", () => withProject((root) => {
    writeApproved(root);
    rmSync(join(root, DESCRIPTOR.planPath));
    mkdirSync(join(root, DESCRIPTOR.planPath));
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "artifact-type");
  }));

  test("rejects independently targeted contained symlinks for every descriptor artifact", () => withProject((root) => {
    for (const field of ["planPath", "metadataPath", "verdictPath"] as const) {
      writeApproved(root);
      const candidate = join(root, DESCRIPTOR[field]);
      const target = `${candidate}.target`;
      writeFileSync(target, readFileSync(candidate));
      rmSync(candidate);
      symlinkSync(target, candidate);
      expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "artifact-type");
      rmSync(candidate);
      rmSync(target);
    }
  }));

  test("rejects pre-capture swaps to internal and external symlinks for every artifact", () => withProject((root) => {
    const outside = mkdtempSync(join(tmpdir(), "approved-artifact-swap-"));
    try {
      for (const external of [false, true]) for (const field of ["planPath", "metadataPath", "verdictPath"] as const) {
        writeApproved(root);
        const candidate = join(root, DESCRIPTOR[field]);
        const target = external ? join(outside, `${field}.target`) : `${candidate}.target`;
        writeFileSync(target, readFileSync(candidate));
        const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, {
          beforeOpen(path) {
            if (path === candidate) { rmSync(candidate); symlinkSync(target, candidate); }
          },
        });
        expect(result, `${field} external=${external}`).toEqual(expect.objectContaining({ code: external ? "policy-path" : "artifact-type" }));
        rmSync(candidate, { force: true });
        if (!external) rmSync(target, { force: true });
      }
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("does not depend on caller-provided no-follow flags", () => withProject((root) => {
    writeApproved(root);
    const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, { noFollowFlag: undefined });
    expect(result).toEqual(expect.objectContaining({ hash: sha256("# Exact current bytes\n") }));
  }));

  test("rejects pathname replacement after the protected descriptor is opened", () => withProject((root) => {
    writeApproved(root);
    const planPath = join(root, DESCRIPTOR.planPath);
    let swapped = false;
    const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, {
      afterOpen(path) {
        if (path !== planPath || swapped) return;
        swapped = true;
        const bytes = readFileSync(path);
        rmSync(path);
        writeFileSync(path, bytes);
      },
    });
    expect(result).toEqual(expect.objectContaining({ code: "approval-race" }));
  }));

  test("validates the live canonical pathname on platforms without proc fd links", () => withProject((root) => {
    writeApproved(root);
    expect(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, {
      forcePathnameFallback: true,
    })).toEqual(expect.objectContaining({ hash: sha256("# Exact current bytes\n") }));

    const planPath = join(root, DESCRIPTOR.planPath);
    let swapped = false;
    const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, {
      forcePathnameFallback: true,
      afterOpen(path) {
        if (path !== planPath || swapped) return;
        swapped = true;
        const bytes = readFileSync(path);
        rmSync(path);
        writeFileSync(path, bytes);
      },
    });
    expect(result).toEqual(expect.objectContaining({ code: "approval-race" }));
  }));

  test("rejects same-inode in-place mutation after the descriptor is opened", () => withProject((root) => {
    writeApproved(root);
    const planPath = join(root, DESCRIPTOR.planPath);
    let rewritten = false;
    const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, {
      afterOpen(path) {
        if (path !== planPath || rewritten) return;
        rewritten = true;
        writeFileSync(path, "# Mutated current byte\n");
      },
    });
    expect(result).toEqual(expect.objectContaining({ code: "approval-race" }));
  }));

  test("rejects altered current-byte hash, metadata schema, and strict timestamps", () => withProject((root) => {
    writeApproved(root, { metadata: {
      schemaVersion: 1, workflow: IDENTITY, planHash: "0".repeat(64), approvedSession: "approval-session", approvedAt: "2026-07-30T10:00:00.000Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "stale-metadata");

    writeApproved(root, { metadata: {
      schemaVersion: 1, workflow: IDENTITY, planHash: sha256("# Exact current bytes\n"), approvedSession: "approval-session", approvedAt: "2026-07-30T10:00:00Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "metadata-schema");

    writeApproved(root, { metadata: {
      schemaVersion: 1, workflow: IDENTITY, planHash: sha256("# Exact current bytes\n"), approvedSession: "approval-session", approvedAt: "2026-07-30T10:00:00.000Z", extra: true,
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "metadata-schema");
  }));

  test("rejects chronology and session-separation changes", () => withProject((root) => {
    writeApproved(root, { verdict: {
      plan_hash: sha256("# Exact current bytes\n"), status: "APPROVED", reviewer_session_id: "review-session", reviewed_at: "2026-07-30T09:00:00.000Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "approval-chronology");

    writeApproved(root);
    expectError(validateApprovedArtifact(root, IDENTITY, "review-session", DESCRIPTOR), "session-separation");

    // Approver == implementer is an actor-separation failure, not a chronology failure. The old
    // code reported both through one `approval-chronology` message, which hid which rule was
    // actually violated; the three actor comparisons now report `session-separation`.
    writeApproved(root, { metadata: {
      schemaVersion: 1, workflow: IDENTITY, planHash: sha256("# Exact current bytes\n"), approvedSession: "implementation-session", approvedAt: "2026-07-30T10:00:00.000Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "session-separation");
    // A dispatching runner is still admitted while equal to the approving session.
    expect(validateApprovedArtifact(root, IDENTITY, { role: "dispatch", identity: "implementation-session" }, DESCRIPTOR)).toEqual(expect.objectContaining({ hash: sha256("# Exact current bytes\n") }));
  }));

  test("rejects verdict hash, schema, and timestamp weakening", () => withProject((root) => {
    writeApproved(root, { verdict: {
      plan_hash: "f".repeat(64), status: "APPROVED", reviewer_session_id: "review-session", reviewed_at: "2026-07-30T11:00:00.000Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "stale-verdict");

    writeApproved(root, { verdict: {
      plan_hash: sha256("# Exact current bytes\n"), status: "APPROVED", reviewer_session_id: "review-session", reviewed_at: "2026-07-30T11:00:00Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "verdict-schema");

    writeApproved(root, { verdict: {
      plan_hash: sha256("# Exact current bytes\n"), status: "APPROVED", reviewer_session_id: "review-session", reviewed_at: "2026-07-30T11:00:00.000Z", extra: "forbidden",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "verdict-schema");
  }));
});

describe("built-in generated-plan and legacy layouts", () => {
  const receipt = (workflow: "ds" | "work" | "writing" | "workshop" | "workflow-creator", planFile: string, hash: string, status = "APPROVED") => ({
    workflow, plan_file: planFile, plan_hash: hash,
    approved_session_id: "approval-session", approved_at: "2026-07-30T10:00:00.000Z",
    status, reviewer_session_id: status === "PENDING" ? "" : "review-session",
    reviewed_at: status === "PENDING" ? "" : "2026-07-30T11:00:00.000Z",
  });
  const legacyMetadata = (workflow: string, hash: string) => ({ schemaVersion: 1, workflow, planHash: hash, approvedSession: "approval-session", approvedAt: "2026-07-30T10:00:00.000Z" });
  const legacyReview = (hash: string) => ({ plan_hash: hash, status: "APPROVED", reviewer_session_id: "review-session", reviewed_at: "2026-07-30T11:00:00.000Z" });
  const frontmatter = (value: Record<string, unknown>) => `---\n${Object.entries(value).map(([key, field]) => `${key}: ${field}`).join("\n")}\n---\n`;

  test("authenticates receipt-selected generated plans for every modern built-in including work", () => withProject((root) => {
    for (const workflow of ["ds", "work", "writing", "workshop", "workflow-creator"] as const) {
      const planFile = `${workflow}-generated.md`; const plan = `# ${workflow} plan\n`; const hash = sha256(plan);
      mkdirSync(join(root, ".planning", ".state"), { recursive: true });
      writeFileSync(join(root, ".planning", planFile), plan);
      writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify(receipt(workflow, planFile, hash)));
      expect(classifyBuiltInArtifactLayout(root, workflow)).toBe("canonical");
      expect(validateApprovedArtifact(root, workflow, "implementation-session")).toEqual(expect.objectContaining({ hash, planFile, receipt: expect.objectContaining({ workflow }) }));
      rmSync(join(root, ".planning"), { recursive: true });
    }
  }));

  test("receipt binding cannot be redirected by a post-open state-directory swap", () => withProject((root) => {
    const outside = mkdtempSync(join(tmpdir(), "approval-state-outside-"));
    try {
      const planning = join(root, ".planning");
      const state = join(planning, ".state");
      const displaced = join(planning, ".state-displaced");
      const planPath = join(planning, "generated-secure.md");
      mkdirSync(state, { recursive: true });
      writeFileSync(planPath, "# Secure binding\n");
      writeFileSync(join(outside, "review.json"), "outside review sentinel\n");
      writeFileSync(join(outside, "plan.json"), "outside plan sentinel\n");

      expect(() => bindApprovedGeneratedPlan(root, "work", planPath, "approval-session", "2026-07-30T10:00:00.000Z", {
        afterStateOpen() {
          renameSync(state, displaced);
          symlinkSync(outside, state);
        },
      })).toThrow(/changed while binding/);
      expect(readFileSync(join(outside, "review.json"), "utf8")).toBe("outside review sentinel\n");
      expect(readFileSync(join(outside, "plan.json"), "utf8")).toBe("outside plan sentinel\n");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("fails closed when descriptor-anchored receipt mutation is unavailable", () => withProject((root) => {
    const outside = mkdtempSync(join(tmpdir(), "approval-state-fallback-outside-"));
    try {
      const planning = join(root, ".planning");
      const state = join(planning, ".state");
      const displaced = join(planning, ".state-displaced");
      const planPath = join(planning, "generated-fallback.md");
      mkdirSync(state, { recursive: true });
      writeFileSync(planPath, "# Portable binding\n");
      writeFileSync(join(outside, "review.json"), "outside review sentinel\n");
      writeFileSync(join(outside, "plan.json"), "outside plan sentinel\n");
      writeFileSync(join(state, "plan.json"), "stale local state\n");

      let strategy = "";
      expect(() => bindApprovedGeneratedPlan(root, "work", planPath, "approval-session", "2026-07-30T10:00:00.000Z", {
        forceNoDescriptorAnchor: true,
        afterStateOpen(selected) { strategy = selected; },
      })).toThrow(/does not support descriptor-anchored mutation/);
      expect(strategy).toBe("pathname");
      expect(existsSync(join(state, "review.json"))).toBe(false);
      expect(readFileSync(join(state, "plan.json"), "utf8")).toBe("stale local state\n");

      strategy = "";
      expect(() => bindApprovedGeneratedPlan(root, "work", planPath, "approval-session", "2026-07-30T10:00:00.000Z", {
        forceNoDescriptorAnchor: true,
        afterStateOpen(selected) {
          strategy = selected;
          renameSync(state, displaced);
          symlinkSync(outside, state);
        },
      })).toThrow(/does not support descriptor-anchored mutation/);
      expect(strategy).toBe("pathname");
      expect(readdirSync(outside).sort()).toEqual(["plan.json", "review.json"]);
      expect(readFileSync(join(outside, "review.json"), "utf8")).toBe("outside review sentinel\n");
      expect(readFileSync(join(outside, "plan.json"), "utf8")).toBe("outside plan sentinel\n");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("descriptorless receipt binding does not create missing state", () => withProject((root) => {
    const planning = join(root, ".planning");
    const state = join(planning, ".state");
    const planPath = join(planning, "generated-no-state.md");
    mkdirSync(planning);
    writeFileSync(planPath, "# No descriptor anchor\n");

    expect(() => bindApprovedGeneratedPlan(root, "work", planPath, "approval-session", "2026-07-30T10:00:00.000Z", {
      forceNoDescriptorAnchor: true,
    })).toThrow(/does not support descriptor-anchored mutation/);
    expect(existsSync(state)).toBe(false);
  }));

  test("descriptor-anchored cleanup removes temporary state after pathname substitution", () => withProject((root) => {
    const outside = mkdtempSync(join(tmpdir(), "approval-state-cleanup-outside-"));
    try {
      const planning = join(root, ".planning");
      const state = join(planning, ".state");
      const displaced = join(planning, ".state-displaced");
      const planPath = join(planning, "generated-cleanup.md");
      mkdirSync(state, { recursive: true });
      writeFileSync(planPath, "# Cleanup binding\n");
      writeFileSync(join(outside, "review.json"), "outside review sentinel\n");

      expect(() => bindApprovedGeneratedPlan(root, "work", planPath, "approval-session", "2026-07-30T10:00:00.000Z", {
        afterTemporaryOpen() {
          renameSync(state, displaced);
          symlinkSync(outside, state);
        },
      })).toThrow(/changed while binding/);
      expect(readdirSync(displaced)).toEqual([]);
      expect(readdirSync(outside)).toEqual(["review.json"]);
      expect(readFileSync(join(outside, "review.json"), "utf8")).toBe("outside review sentinel\n");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("PENDING authenticates exact approval identity but does not authorize implementation", () => withProject((root) => {
    const planFile = "pending-generated.md"; const plan = "# Pending\n"; const hash = sha256(plan);
    mkdirSync(join(root, ".planning", ".state"), { recursive: true }); writeFileSync(join(root, ".planning", planFile), plan);
    writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify(receipt("work", planFile, hash, "PENDING")));
    expect(validateApprovedPlan(root, "work")).toEqual(expect.objectContaining({ hash, planFile, receipt: expect.objectContaining({ status: "PENDING" }) }));
    expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "review-pending" }));
  }));

  test("rejects stale hashes, duplicate keys, unsafe names, session reuse, and chronology", () => withProject((root) => {
    const planFile = "strict-generated.md"; const plan = "# Strict\n"; const hash = sha256(plan); const path = join(root, ".planning", ".state", "review.json");
    mkdirSync(join(root, ".planning", ".state"), { recursive: true }); writeFileSync(join(root, ".planning", planFile), plan);
    writeFileSync(path, JSON.stringify(receipt("work", planFile, "0".repeat(64)))); expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "stale-receipt" }));
    const valid = JSON.stringify(receipt("work", planFile, hash)); writeFileSync(path, valid.replace('"workflow":', '"workflow":"work","workflow":'));
    expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "review-duplicate" }));
    writeFileSync(path, JSON.stringify({ ...receipt("work", planFile, hash), plan_file: "PLAN.md" })); expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "review-schema" }));
    writeFileSync(path, JSON.stringify({ ...receipt("work", planFile, hash), reviewed_at: "2026-07-30T09:00:00.000Z" })); expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "approval-chronology" }));
    // Three actors, three roles. A bare string names an IMPLEMENTING actor and carries the full
    // rule: approver, reviewer, and implementer must all differ. The dispatching actor is a
    // different role — the implementer it is about to create does not exist yet — so it is named
    // explicitly and is allowed to be the approver.
    writeFileSync(path, JSON.stringify(receipt("work", planFile, hash))); expect(validateApprovedArtifact(root, "work", "review-session")).toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateApprovedArtifact(root, "work", "")).toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateApprovedArtifact(root, "work", undefined)).toEqual(expect.objectContaining({ code: "session-separation" }));
    // RESTORED INVARIANT: the approving actor may not be the implementing actor.
    expect(validateApprovedArtifact(root, "work", "approval-session")).toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateApprovedArtifact(root, "work", { role: "implement", identity: "approval-session" })).toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateApprovedArtifact(root, "work", { role: "implement", identity: "review-session" })).toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateApprovedArtifact(root, "work", { role: "implement", identity: "implementation-session" })).toEqual(expect.objectContaining({ hash }));
    // A DISPATCHING actor is admitted while equal to the approver: single-conversation /dev has the
    // conversation approve the plan and then dispatch implementers. It still may not be the reviewer.
    expect(validateApprovedArtifact(root, "work", { role: "dispatch", identity: "approval-session" })).toEqual(expect.objectContaining({ hash }));
    expect(validateApprovedArtifact(root, "work", { role: "dispatch", identity: "review-session" })).toEqual(expect.objectContaining({ code: "session-separation" }));
    // A malformed actor descriptor fails CLOSED with a controlled error, never a crash.
    for (const actor of [{}, { role: "implement" }, { identity: "x" }, { role: "audit", identity: "x" }, { role: "implement", identity: "" }, { role: "implement", identity: 7 }, 7, null, []]) {
      expect(validateApprovedArtifact(root, "work", actor as unknown)).toEqual(expect.objectContaining({ code: "session-separation" }));
    }
    writeFileSync(path, JSON.stringify({ ...receipt("work", planFile, hash), reviewer_session_id: "approval-session" })); expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "session-separation" }));
  }));

  test("implementation approval binding fails closed on an absent or malformed actor identity", () => withProject((root) => {
    const planFile = "binding-generated.md"; const plan = "# Binding\n"; const hash = sha256(plan);
    mkdirSync(join(root, ".planning", ".state"), { recursive: true }); writeFileSync(join(root, ".planning", planFile), plan);
    writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify(receipt("work", planFile, hash)));
    const artifact = validateApprovedArtifact(root, "work", { role: "dispatch", identity: "approval-session" }) as ApprovedArtifact;
    expect(artifact).toEqual(expect.objectContaining({ hash }));
    const base = { taskIdentity: "task-a", taskContractDigest: "b".repeat(64), preDispatchObservationDigest: "c".repeat(64) };
    // beat-implement reached `.trim()` on an absent identity and threw an uncaught TypeError out of
    // the runner instead of denying. Every non-string must return a controlled ArtifactError.
    for (const identity of [undefined, null, 7, {}, ""]) {
      expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: identity as unknown as string }))
        .toEqual(expect.objectContaining({ code: "session-separation" }));
    }
    // Default role is the strict one: a bare binding names an implementer and may not be the approver.
    expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: "approval-session" }))
      .toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: "review-session" }))
      .toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: "implementation-session" }))
      .toEqual(expect.objectContaining({ schemaVersion: 2, planHash: hash }));
    // A dispatching runner declares its role and may equal the approver, never the reviewer.
    expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: "approval-session", implementationRole: "dispatch" }))
      .toEqual(expect.objectContaining({ schemaVersion: 2, planHash: hash }));
    expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: "review-session", implementationRole: "dispatch" }))
      .toEqual(expect.objectContaining({ code: "session-separation" }));
    expect(validateBuiltInImplementationApproval(artifact, "work", { ...base, implementationSession: "x", implementationRole: "audit" as unknown as "dispatch" }))
      .toEqual(expect.objectContaining({ code: "session-separation" }));
  }));

  test("rejects generated plan symlinks and path substitution", () => withProject((root) => {
    const outside = mkdtempSync(join(tmpdir(), "generated-outside-"));
    try {
      const planFile = "linked-generated.md"; const plan = "# linked\n"; const hash = sha256(plan);
      mkdirSync(join(root, ".planning", ".state"), { recursive: true }); writeFileSync(join(outside, planFile), plan); symlinkSync(join(outside, planFile), join(root, ".planning", planFile));
      writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify(receipt("work", planFile, hash)));
      // Pinned exactly. `stringMatching(/artifact-type|policy-path/)` accepted EITHER of two
      // different rejections, so a change that moved the symlink from one rule to the other would
      // have passed silently while the rule this test names stopped running.
      expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "policy-path" }));
    } finally { rmSync(outside, { recursive: true, force: true }); }
  }));

  test("treats copied fixed PLAN as provenance and rejects active legacy authority", () => withProject((root) => {
    const generated = "generated.md"; const plan = "# Generated\n"; const hash = sha256(plan); const legacy = "# Legacy\n"; const legacyHash = sha256(legacy);
    mkdirSync(join(root, ".planning", ".state"), { recursive: true }); writeFileSync(join(root, ".planning", generated), plan); writeFileSync(join(root, ".planning", "PLAN.md"), legacy);
    writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify(receipt("work", generated, hash)));
    expect(classifyBuiltInArtifactLayout(root, "work")).toBe("canonical-with-legacy-provenance");
    writeFileSync(join(root, ".planning", "PLAN.meta.json"), JSON.stringify(legacyMetadata("work", legacyHash)));
    writeFileSync(join(root, ".planning", "PLAN_REVIEWED.md"), frontmatter(legacyReview(legacyHash)));
    expect(classifyBuiltInArtifactLayout(root, "work")).toBe("conflict");
    expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "artifact-layout-conflict" }));
  }));

  test("treats a strict built-in clarification sentinel as benign but non-resumable", () => withProject((root) => {
    mkdirSync(join(root, ".planning", ".state"), { recursive: true });
    writeFileSync(join(root, ".planning", "DEV_CLARIFIED.json"), '{"status":"clarified","sessionId":"clarifier"}\n');
    expect(classifyPlanningLifecycle(root)).toEqual({ kind: "none" });
    writeFileSync(join(root, ".planning", "STATE.md"), "retired state\n");
    expect(classifyPlanningLifecycle(root)).toEqual(expect.objectContaining({ kind: "blocked", reason: "conversion-required" }));
  }));

  test("treats legacy fixed artifacts as conversion-only provenance", () => withProject((root) => {
    const plan = "# Legacy\n"; const hash = sha256(plan); mkdirSync(join(root, ".planning"), { recursive: true });
    writeFileSync(join(root, ".planning", "PLAN.md"), plan); writeFileSync(join(root, ".planning", "PLAN.meta.json"), JSON.stringify(legacyMetadata("work", hash))); writeFileSync(join(root, ".planning", "PLAN_REVIEWED.md"), frontmatter(legacyReview(hash)));
    expect(validateApprovedArtifact(root, "work", "implementation-session")).toEqual(expect.objectContaining({ code: "conversion-required" }));
    expect(validateApprovedArtifact(root, "dev", "implementation-session")).toEqual(expect.objectContaining({ code: "conversion-required" }));
  }));
});

describe("hook actor identity", () => {
  // The identity the review and implementation gates compare MUST come from the hook payload.
  // process.env.CLAUDE_SESSION_ID does not exist in a real hook process, and the tree-wide
  // CLAUDE_CODE_SESSION_ID is byte-identical in a conversation and in the subagents it dispatches.
  test("separates a conversation from the subagents it dispatches", () => {
    expect(hookActorIdentity({ session_id: "sess-1" })).toBe("sess-1");
    expect(hookActorIdentity({ session_id: "sess-1", agent_id: "a850df8", agent_type: "general-purpose" })).toBe("sess-1#a850df8");
    expect(hookActorIdentity({ session_id: "sess-1" })).not.toBe(hookActorIdentity({ session_id: "sess-1", agent_id: "a850df8" }));
    expect(hookActorIdentity({ session_id: "sess-1", agent_id: "a1" })).not.toBe(hookActorIdentity({ session_id: "sess-1", agent_id: "a2" }));
  });

  test("fails closed rather than defaulting", () => {
    for (const payload of [null, undefined, "sess-1", ["sess-1"], {}, { session_id: "" }, { session_id: "   " }, { session_id: 1 },
      { session_id: "sess-1", agent_id: "" }, { session_id: "sess-1", agent_id: 7 }]) {
      expect(hookActorIdentity(payload)).toBeNull();
    }
    // The separator may not appear in either component, so one actor cannot spell another's identity.
    expect(hookActorIdentity({ session_id: "sess#1" })).toBeNull();
    expect(hookActorIdentity({ session_id: "sess-1", agent_id: "a#b" })).toBeNull();
    // An absent agent_id is a conversation-level call, not an error.
    expect(hookActorIdentity({ session_id: "sess-1", agent_id: null })).toBe("sess-1");
  });

  test("reports whether the call came from inside a subagent", () => {
    expect(isSubagentPayload({ session_id: "sess-1", agent_id: "a1" })).toBe(true);
    expect(isSubagentPayload({ session_id: "sess-1" })).toBe(false);
    expect(isSubagentPayload({ session_id: "sess-1", agent_id: "" })).toBe(false);
    expect(isSubagentPayload(null)).toBe(false);
  });
});
