import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const TARGET_VERSION = "5.139.0";

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
    descriptorSchema: "preflight request + validated WorkflowPolicy",
    contractVersion: "3",
    discoveryInput: "Explicit projectDir + workflow policy + readyWave + immutable approval reset",
    successEvidence: "PreflightResult with per-task approval bindings, routing decision, derived adjudication expectation, and the emitted script path when one is warranted",
    rejectionEvidence: "Thrown Error before any dispatch",
    compatibility: "Contract 2 returned per-task execution records from a Workflow script that could not run under the Workflow runtime; contract 3 splits it into this pre-step and the observation hooks, which own execution evidence. Inputs are unchanged; consumers that read result records must read hook records instead",
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
  test("all three plugin version fields and capability identity agree at 5.139.0", () => {
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

  test("publishes a PATH broker for the exact installed dependency root", () => {
    const broker = join(ROOT, "bin/workflows-capability-root");
    expect(existsSync(broker)).toBe(true);
    const result = Bun.spawnSync([broker], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe(ROOT);
  });

  test("ships without ignored planning files as public contract authority", () => {
    const documentation = readFileSync(join(ROOT, "docs/extension-contracts.md"), "utf8");
    expect(documentation).not.toContain(".planning/STAGE1_EVIDENCE.md");
    expect(documentation).toContain("exact-byte");
    expect(documentation).toContain("TaskList");
  });
});
