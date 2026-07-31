import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha256,
  validateApprovedArtifact,
  validateCapturedApprovalBundle,
  type ApprovalPolicyDescriptor,
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

  test("rejects unknown identities without an explicit descriptor", () => withProject((root) => {
    writeApproved(root);
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session"), "unknown-workflow");
  }));

  test("captured approval rejects artifacts that do not bind the named task and pre-dispatch state", () => withProject((root) => {
    writeApproved(root);
    const captured = captureApprovalBundle(root, Buffer.from(JSON.stringify(DESCRIPTOR)), DESCRIPTOR);
    const result = validateCapturedApprovalBundle(captured, IDENTITY, {
      taskIdentity: "task-14",
      taskContractDigest: "a".repeat(64),
      preDispatchObservationDigest: "b".repeat(64),
      implementationSession: "implementation-session",
    });

    expect(result).toEqual(expect.objectContaining({ code: expect.any(String) }));
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

  test("does not depend on O_NOFOLLOW availability or stable device/inode identity", () => withProject((root) => {
    writeApproved(root);
    const replaced = new Set<string>();
    const result = validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR, {
      noFollowFlag: undefined,
      beforeOpen(path) {
        if (replaced.has(path)) return;
        replaced.add(path);
        const bytes = readFileSync(path);
        rmSync(path);
        writeFileSync(path, bytes);
      },
    });
    expect(result).toEqual(expect.objectContaining({ hash: sha256("# Exact current bytes\n") }));
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

    writeApproved(root, { metadata: {
      schemaVersion: 1, workflow: IDENTITY, planHash: sha256("# Exact current bytes\n"), approvedSession: "implementation-session", approvedAt: "2026-07-30T10:00:00.000Z",
    } });
    expectError(validateApprovedArtifact(root, IDENTITY, "implementation-session", DESCRIPTOR), "approval-chronology");
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
