import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { captureCandidate, serializeCandidateManifest } from "../workflows/lib/candidate-manifest";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const TARGET_VERSION = "5.102.0";

type Capability = {
  name: string;
  contractVersion: number;
  implementation: string;
};

type ContractRow = {
  capability: string;
  descriptorSchema: string;
  contractVersion: string;
  discoveryInput: string;
  successEvidence: string;
  rejectionEvidence: string;
  compatibility: string;
};

const EXPECTED_ROWS: ContractRow[] = [
  {
    capability: "capability-resolver",
    descriptorSchema: "capabilities.json schema 1",
    contractVersion: "1",
    discoveryInput: "Explicit installed dependency root + capability name",
    successEvidence: "ResolvedDependencyCapability",
    rejectionEvidence: "Thrown Error with stable category text",
    compatibility: "Additive within contract 1; breaking changes require a new contract version",
  },
  {
    capability: "constraint-loader",
    descriptorSchema: "No descriptor; LoadConstraintsOptions API schema 1",
    contractVersion: "1",
    discoveryInput: "Explicit constraint directory + skill name; optional marker path",
    successEvidence: "ConstraintLoadResult with ConstraintLoadEvidence",
    rejectionEvidence: "Thrown Error; CLI exits nonzero with Error text",
    compatibility: "API result and existing CLI output remain compatible within contract 1",
  },
  {
    capability: "phase-gate-evaluator",
    descriptorSchema: "No descriptor; PhaseGateConfig/Payload API schema 1",
    contractVersion: "1",
    discoveryInput: "Caller-supplied canonical project root + config + hook payload",
    successEvidence: "PhaseGateDecision allow or deny(reason)",
    rejectionEvidence: "Typed deny decision; malformed invocation fails closed",
    compatibility: "Decision union and existing hook bytes remain compatible within contract 1",
  },
  {
    capability: "approved-artifact-policy",
    descriptorSchema: "Receipt-selected generated-plan state or ApprovalPolicyDescriptor schema 1",
    contractVersion: "3",
    discoveryInput: "Explicit project root + validated workflow policy + current session",
    successEvidence: "ApprovedArtifact bound to the authenticated plan identity and approval mode",
    rejectionEvidence: "ArtifactError { code, message }",
    compatibility: "Security invariants cannot be disabled; validated external generated-plan workflows are contract 3",
  },
  {
    capability: "workflow-policy-loader",
    descriptorSchema: "WorkflowPolicyDescriptor schema 1 or native schema 2",
    contractVersion: "2",
    discoveryInput: "Explicit descriptor file path or one built-in workflow argument",
    successEvidence: "Frozen WorkflowPolicy with explicit approvalMode",
    rejectionEvidence: "Thrown Error prefixed Invalid workflow policy descriptor",
    compatibility: "Schema 1 fixed artifacts remain compatible; schema 2 adds generated-plan mode without ambient inference",
  },
  {
    capability: "beat-implement-runner",
    descriptorSchema: "runner args + validated WorkflowPolicy",
    contractVersion: "2",
    discoveryInput: "Explicit projectDir + workflow policy + readyWave + immutable approval reset",
    successEvidence: "Structured runner result with per-task records, plan identity, and mutation evidence",
    rejectionEvidence: "Thrown Error before dispatch or failed per-task result record",
    compatibility: "Schema 1 fixed-artifact workflows remain compatible; native plan identity support is contract 2",
  },
  {
    capability: "plan-review-composer",
    descriptorSchema: "No descriptor; PlanReviewComposition API schema 1",
    contractVersion: "1",
    discoveryInput: "Explicit projectDir + validated generated-plan policy + non-empty common/domain checks",
    successEvidence: "Frozen PlanReviewComposition with one verdict, findings, and executed check IDs",
    rejectionEvidence: "ArtifactError { code, message }; no partial evidence or finalization on failure",
    compatibility: "Common-before-domain ordering, authenticated whole-plan input, and review-owned finalization remain compatible within contract 1",
  },
  {
    capability: "tasklist-reconciler",
    descriptorSchema: "No descriptor; TaskList reconciliation API schema 1",
    contractVersion: "1",
    discoveryInput: "Explicit current planHash + plan TaskContracts + existing TaskList snapshot",
    successEvidence: "Frozen tool-neutral actions and current implementation-ID mapping",
    rejectionEvidence: "Thrown Error for invalid input; block action for ambiguous live identity",
    compatibility: "Identity is exactly planHash + plan_task_id + item_kind; task-kind and supersession changes require a new contract version",
  },
];

function parseContractRows(markdown: string): ContractRow[] {
  const marker = "<!-- public-extension-contract-table -->";
  const start = markdown.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const rows = markdown.slice(start + marker.length).split("\n").filter((line) => line.startsWith("| `"));
  return rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("\\|", "|"));
    expect(cells).toHaveLength(7);
    return {
      capability: cells[0].replaceAll("`", ""),
      descriptorSchema: cells[1],
      contractVersion: cells[2].replaceAll("`", ""),
      discoveryInput: cells[3],
      successEvidence: cells[4],
      rejectionEvidence: cells[5],
      compatibility: cells[6],
    };
  });
}

describe("public extension contract integration", () => {
  test("all three plugin version fields and capability identity agree at 5.102.0", () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
    const marketplace = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/capabilities.json"), "utf8"));

    expect(plugin.version).toBe(TARGET_VERSION);
    expect(marketplace.metadata.version).toBe(TARGET_VERSION);
    expect(marketplace.plugins.find((entry: { name: string }) => entry.name === plugin.name)?.version).toBe(TARGET_VERSION);
    expect(manifest.plugin).toEqual({ name: plugin.name, version: TARGET_VERSION });
  });

  test("advertised capability paths and contract versions match the documented consumer API", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/capabilities.json"), "utf8")) as {
      schemaVersion: number;
      capabilities: Capability[];
    };
    const documentation = readFileSync(join(ROOT, "docs/extension-contracts.md"), "utf8");
    const documentedRows = parseContractRows(documentation);

    expect(manifest.schemaVersion).toBe(1);
    expect(documentedRows).toEqual(EXPECTED_ROWS);
    expect(manifest.capabilities.map(({ name, contractVersion }) => ({ name, contractVersion }))).toEqual(
      EXPECTED_ROWS.map(({ capability, contractVersion }) => ({ name: capability, contractVersion: Number(contractVersion) })),
    );
    for (const capability of manifest.capabilities) {
      expect(capability.implementation.startsWith("/")).toBe(false);
      expect(capability.implementation.split("/")).not.toContain("..");
      expect(existsSync(join(ROOT, capability.implementation))).toBe(true);
    }
  });

  test("binds terminal integration evidence to the one canonical candidate", () => {
    const evidence = readFileSync(join(ROOT, ".planning/STAGE1_EVIDENCE.md"), "utf8");
    const migration = readFileSync(join(ROOT, ".planning/MIGRATION.md"), "utf8");
    const validation = readFileSync(join(ROOT, ".planning/VALIDATION.md"), "utf8");
    const documentation = readFileSync(join(ROOT, "docs/extension-contracts.md"), "utf8");
    const match = evidence.match(/<!-- canonical-stage1-evidence\n([\s\S]*?)\n-->/);
    expect(match).not.toBeNull();
    const record = JSON.parse(match![1]) as {
      schemaVersion: number;
      finalManifestDigest: string;
      canonicalManifest: string;
      terminal: Record<string, string>;
      supersededCaptures: { digest: string; releaseEligible: boolean; reason: string }[];
      recapture: { status: string; affectedChecks: string[]; completedChecks: string[] };
      historicalTraceLinks: { approvals: string; observations: string };
      release: { independentVerification: string; humanApproval: string };
    };
    const candidate = captureCandidate({ repositoryRoot: ROOT, baseRef: "HEAD" });
    const manifestText = new TextDecoder().decode(serializeCandidateManifest(candidate.manifest));

    expect(record.schemaVersion).toBe(1);
    expect(record.finalManifestDigest).toBe(candidate.manifestDigest);
    expect(record.canonicalManifest).toBe(manifestText);
    expect(Object.values(record.terminal)).toEqual([
      candidate.manifestDigest,
      candidate.manifestDigest,
      candidate.manifestDigest,
      candidate.manifestDigest,
      candidate.manifestDigest,
    ]);
    expect(record.supersededCaptures.length).toBeGreaterThan(0);
    expect(record.supersededCaptures.every((capture) => !capture.releaseEligible && capture.reason.length > 0)).toBe(true);
    expect(record.recapture.status).toBe("eligible");
    expect(record.recapture.affectedChecks.length).toBeGreaterThan(0);
    expect(record.recapture.completedChecks).toEqual(record.recapture.affectedChecks);
    expect(record.historicalTraceLinks.approvals).toContain("#historical-approval-and-observation-traces");
    expect(record.historicalTraceLinks.observations).toContain("#historical-approval-and-observation-traces");
    expect(record.release.independentVerification).toBe("pending");
    expect(record.release.humanApproval).toBe("pending-after-independent-pass");

    for (const text of [migration, validation]) {
      expect(text).toContain(candidate.manifestDigest);
      expect(text).toContain(".planning/STAGE1_EVIDENCE.md");
    }
    expect(documentation).toContain(".planning/STAGE1_EVIDENCE.md");
    expect(documentation).toContain("transient paths created and removed entirely during dispatch");
    expect(documentation).toContain("malicious same-user process");
  });
});
