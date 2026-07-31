import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { sha256 } from "../workflows/lib/approved-artifact.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadExternalWorkflowPolicy,
  workflowPolicyFromArg,
} from "../hooks/lib/workflow-policy.ts";
import { workflowFromArg } from "../hooks/_workflow_policies.ts";

function descriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workflow: "opaque-extension",
    clarifySentinel: ".planning/OPAQUE_CLARIFIED.json",
    clarifyReason: "Ask the extension's opening questions before reconnaissance.",
    reviewerVerdict: ".planning/PLAN_REVIEWED.md",
    approvalPolicy: ".approval/policy.json",
    allowedOrchestratorDirectories: [".planning", ".claude"],
    ...overrides,
  };
}

function writeDescriptor(value: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "workflow-policy-"));
  const path = join(root, "policy.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

describe("external workflow policy contract", () => {
  test("accepts an opaque explicit descriptor without public registration", () => {
    const path = writeDescriptor(descriptor());
    const policy = workflowPolicyFromArg(["--workflow-policy", path]);

    expect(policy).toEqual({
      workflow: "opaque-extension",
      clarifySentinel: ".planning/OPAQUE_CLARIFIED.json",
      clarifyReason: "Ask the extension's opening questions before reconnaissance.",
      reviewerVerdict: ".planning/PLAN_REVIEWED.md",
      approvalPolicy: ".approval/policy.json",
      allowedOrchestratorDirectories: [".planning", ".claude"],
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy?.allowedOrchestratorDirectories)).toBe(true);
    expect(workflowFromArg(["--workflow", "opaque-extension"])).toBeNull();
  });

  test("requires explicit selection and never performs ambient lookup", () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-policy-ambient-"));
    writeFileSync(join(root, "workflow-policy.json"), `${JSON.stringify(descriptor())}\n`);
    const previous = process.cwd();
    process.chdir(root);
    try {
      expect(workflowPolicyFromArg([])).toBeNull();
      expect(workflowPolicyFromArg(["--workflow", "opaque-extension"])).toBeNull();
    } finally {
      process.chdir(previous);
    }
  });

  test("rejects unknown keys and malformed descriptors", () => {
    expect(() => loadExternalWorkflowPolicy(writeDescriptor(descriptor({ extra: true })))).toThrow(/unknown|only/i);
    expect(() => loadExternalWorkflowPolicy(writeDescriptor({ ...descriptor(), schemaVersion: 2 }))).toThrow(/schemaVersion/i);
    expect(() => loadExternalWorkflowPolicy(writeDescriptor({ ...descriptor(), workflow: "ds" }))).toThrow(/built-in/i);
  });

  test.each([
    ["absolute sentinel", { clarifySentinel: "/tmp/clarified.json" }],
    ["traversing sentinel", { clarifySentinel: "../clarified.json" }],
    ["empty segment", { reviewerVerdict: ".planning//PLAN_REVIEWED.md" }],
    ["absolute allowed directory", { allowedOrchestratorDirectories: ["/tmp"] }],
    ["traversing allowed directory", { allowedOrchestratorDirectories: [".planning", "../outside"] }],
    ["duplicate allowed directory", { allowedOrchestratorDirectories: [".planning", ".planning"] }],
  ])("rejects invalid project-relative paths: %s", (_label, overrides) => {
    expect(() => loadExternalWorkflowPolicy(writeDescriptor(descriptor(overrides)))).toThrow(/path|directory|relative|duplicate/i);
  });

  test("rejects duplicate or ambiguous selection modes", () => {
    const path = writeDescriptor(descriptor());
    expect(workflowPolicyFromArg(["--workflow-policy", path, "--workflow-policy", path])).toBeNull();
    expect(workflowPolicyFromArg(["--workflow", "ds", "--workflow-policy", path])).toBeNull();
    expect(workflowPolicyFromArg(["--workflow", "ds", "--workflow", "dev"])).toBeNull();
  });

  test("approved-artifact hook accepts an authenticated opaque workflow only with matching explicit descriptors", async () => {
    const root = mkdtempSync(join(tmpdir(), "external-hook-route-"));
    try {
      mkdirSync(join(root, ".approval"), { recursive: true });
      const plan = "# Current external plan\n";
      const hash = sha256(plan);
      writeFileSync(join(root, ".approval/CURRENT.md"), plan);
      writeFileSync(join(root, ".approval/CURRENT.meta.json"), JSON.stringify({ schemaVersion: 1, workflow: "opaque-extension", planHash: hash, approvedSession: "approve", approvedAt: "2026-07-30T10:00:00.000Z" }));
      writeFileSync(join(root, ".approval/CURRENT_REVIEWED.md"), `---\nplan_hash: ${hash}\nstatus: APPROVED\nreviewer_session_id: review\nreviewed_at: 2026-07-30T11:00:00.000Z\n---\n`);
      writeFileSync(join(root, ".approval/policy.json"), JSON.stringify({ schemaVersion: 1, workflow: "opaque-extension", planPath: ".approval/CURRENT.md", metadataPath: ".approval/CURRENT.meta.json", verdictPath: ".approval/CURRENT_REVIEWED.md" }));
      const workflowPath = join(root, "workflow.json");
      writeFileSync(workflowPath, JSON.stringify(descriptor()));
      const payload = JSON.stringify({ tool_name: "Agent", tool_input: { subagent_type: "implementation" }, cwd: root });
      const run = (args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "../hooks/approved-artifact-gate.ts"), ...args], { stdin: Buffer.from(payload), env: { ...process.env, CLAUDE_SESSION_ID: "implement" } });
      expect(run(["--workflow-policy", workflowPath]).stdout.toString()).toBe("");
      expect(run(["--workflow-policy", join(root, "missing.json")]).exitCode).not.toBe(0);
      writeFileSync(join(root, ".approval/policy.json"), "{}\n");
      expect(run(["--workflow-policy", workflowPath]).stdout.toString()).toContain("permissionDecision");
      writeFileSync(join(root, ".approval/policy.json"), JSON.stringify({ schemaVersion: 1, workflow: "wrong", planPath: ".approval/CURRENT.md", metadataPath: ".approval/CURRENT.meta.json", verdictPath: ".approval/CURRENT_REVIEWED.md" }));
      expect(run(["--workflow-policy", workflowPath]).stdout.toString()).toContain("permissionDecision");

      writeFileSync(join(root, ".approval/policy-target.json"), JSON.stringify({ schemaVersion: 1, workflow: "opaque-extension", planPath: ".approval/CURRENT.md", metadataPath: ".approval/CURRENT.meta.json", verdictPath: ".approval/CURRENT_REVIEWED.md" }));
      rmSync(join(root, ".approval/policy.json"));
      symlinkSync("policy-target.json", join(root, ".approval/policy.json"));
      expect(run(["--workflow-policy", workflowPath]).stdout.toString()).toContain("symbolic link");

      rmSync(join(root, ".approval/policy.json"));
      mkdirSync(join(root, "policy-real"));
      writeFileSync(join(root, "policy-real/policy.json"), readFileSync(join(root, ".approval/policy-target.json")));
      symlinkSync("policy-real", join(root, "policy-link"));
      const ancestorWorkflowPath = join(root, "workflow-ancestor.json");
      writeFileSync(ancestorWorkflowPath, JSON.stringify(descriptor({ approvalPolicy: "policy-link/policy.json" })));
      expect(run(["--workflow-policy", ancestorWorkflowPath]).stdout.toString()).toContain("symbolic link");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("preserves immutable built-ins across external loads", () => {
    const before = workflowFromArg(["--workflow", "ds"]);
    expect(before).not.toBeNull();
    const snapshot = JSON.parse(JSON.stringify(before));

    const path = writeDescriptor(descriptor());
    const external = workflowFromArg(["--workflow-policy", path]);
    expect(external?.workflow).toBe("opaque-extension");

    const after = workflowFromArg(["--workflow", "ds"]);
    expect(after).toEqual(snapshot);
    expect(after).toBe(before);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after?.allowedOrchestratorDirectories)).toBe(true);

    expect(() => {
      (external?.allowedOrchestratorDirectories as string[]).push("scripts");
    }).toThrow();
    expect(readFileSync(path, "utf8")).toContain("opaque-extension");
  });
});
