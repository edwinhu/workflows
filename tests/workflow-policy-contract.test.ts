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

function generatedPlanDescriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    workflow: "opaque-native-extension",
    approvalMode: "generated-plan-receipt-v1",
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

function writeDescriptorText(value: string): string {
  const root = mkdtempSync(join(tmpdir(), "workflow-policy-"));
  const path = join(root, "policy.json");
  writeFileSync(path, value);
  return path;
}

describe("external workflow policy contract", () => {
  test("accepts an opaque explicit descriptor without public registration", () => {
    const path = writeDescriptor(descriptor());
    const policy = workflowPolicyFromArg(["--workflow-policy", path]);

    expect(policy).toEqual({
      workflow: "opaque-extension",
      approvalMode: "external-fixed-v1",
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

  test("accepts schema-v2 generated-plan receipt descriptors without legacy paths", () => {
    const policy = loadExternalWorkflowPolicy(writeDescriptor(generatedPlanDescriptor()));

    expect(policy).toEqual({
      workflow: "opaque-native-extension",
      approvalMode: "generated-plan-receipt-v1",
      allowedOrchestratorDirectories: [".planning", ".claude"],
    });
    expect("clarifySentinel" in policy).toBe(false);
    expect("reviewerVerdict" in policy).toBe(false);
    expect("approvalPolicy" in policy).toBe(false);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowedOrchestratorDirectories)).toBe(true);
  });

  test("normalizes every policy to one explicit approval mode", () => {
    expect(loadExternalWorkflowPolicy(writeDescriptor(descriptor())).approvalMode).toBe("external-fixed-v1");
    expect(loadExternalWorkflowPolicy(writeDescriptor(generatedPlanDescriptor())).approvalMode).toBe("generated-plan-receipt-v1");
    for (const workflow of ["ds", "dev", "work", "writing", "workshop", "workflow-creator"]) {
      expect(workflowFromArg(["--workflow", workflow])?.approvalMode).toBe("built-in-native");
    }
  });

  test("schema-v2 rejects legacy paths, mode changes, and noncanonical directory lists", () => {
    for (const invalid of [
      generatedPlanDescriptor({ clarifySentinel: ".planning/CLARIFIED.json" }),
      generatedPlanDescriptor({ reviewerVerdict: ".planning/.state/review.json" }),
      generatedPlanDescriptor({ approvalPolicy: ".approval/policy.json" }),
      generatedPlanDescriptor({ approvalMode: "external-fixed-v1" }),
      generatedPlanDescriptor({ allowedOrchestratorDirectories: [] }),
      generatedPlanDescriptor({ allowedOrchestratorDirectories: [".planning", "../outside"] }),
    ]) expect(() => loadExternalWorkflowPolicy(writeDescriptor(invalid))).toThrow(/descriptor|approvalMode|directory|only/i);
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

  test("rejects unknown keys, duplicate keys, and malformed descriptors", () => {
    expect(() => loadExternalWorkflowPolicy(writeDescriptor(descriptor({ extra: true })))).toThrow(/unknown|only/i);
    expect(() => loadExternalWorkflowPolicy(writeDescriptor({ ...descriptor(), schemaVersion: 3 }))).toThrow(/schemaVersion/i);
    expect(() => loadExternalWorkflowPolicy(writeDescriptorText('{"schemaVersion":2,"workflow":"teaching","workflow":"substituted","approvalMode":"generated-plan-receipt-v1","allowedOrchestratorDirectories":[".planning"]}'))).toThrow(/duplicate/i);
  });

  test.each(["ds", "dev", "work", "writing", "workshop", "workflow-creator"])("rejects external descriptors claiming built-in identity %s", (workflow) => {
    expect(() => loadExternalWorkflowPolicy(writeDescriptor(descriptor({ workflow })))).toThrow(/built-in/i);
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
      // Identity comes from the payload: session_id plus agent_id when the call is made inside a
      // subagent. CLAUDE_SESSION_ID is never set by Claude Code, so injecting it here tested a
      // variable production does not have.
      const payload = JSON.stringify({ session_id: "implement", cwd: root, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "implementation" } });
      const env = { ...process.env }; delete env.CLAUDE_SESSION_ID;
      const run = (args: string[]) => Bun.spawnSync(["bun", join(import.meta.dir, "../hooks/approved-artifact-gate.ts"), ...args], { stdin: Buffer.from(payload), env });
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

  test("approved-artifact gate validates schema-v2 external generated-plan receipts", () => {
    const root = mkdtempSync(join(tmpdir(), "external-generated-gate-"));
    try {
      mkdirSync(join(root, ".planning", ".state"), { recursive: true });
      const planFile = "opaque-generated.md";
      const plan = "# Opaque generated plan\n";
      const hash = sha256(plan);
      writeFileSync(join(root, ".planning", planFile), plan);
      writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify({
        workflow: "opaque-native-extension", plan_file: planFile, plan_hash: hash,
        approved_session_id: "approve", approved_at: "2026-07-30T10:00:00.000Z",
        status: "APPROVED", reviewer_session_id: "review", reviewed_at: "2026-07-30T11:00:00.000Z",
      }));
      const workflowPath = join(root, "workflow.json");
      writeFileSync(workflowPath, JSON.stringify(generatedPlanDescriptor()));
      // PRODUCTION'S ACTUAL ENVIRONMENT. The original of this case injected
      // `CLAUDE_SESSION_ID: "implement"` and sent a payload with no session_id — a variable Claude
      // Code never sets, so it asserted an admission that cannot happen in a real hook process.
      // Identity comes from the payload; the env var is deleted so its absence is what is tested.
      const env = { ...process.env }; delete env.CLAUDE_SESSION_ID;
      const run = (identity: Record<string, unknown>) => Bun.spawnSync(
        ["bun", join(import.meta.dir, "../hooks/approved-artifact-gate.ts"), "--workflow-policy", workflowPath],
        { cwd: root, env, stdin: Buffer.from(JSON.stringify({ ...identity, tool_name: "Agent", tool_input: { subagent_type: "implementation", projectDir: root }, cwd: root })) },
      );

      // A conversation-level call is DISPATCHING, so it is admitted even though it is the approver:
      // the implementer it is about to create has no identity yet. A three-way distinctness check
      // (`new Set([approved, reviewer, current]).size !== 3`) cannot express this and denies here.
      const dispatch = run({ session_id: "approve" });
      expect(dispatch.exitCode).toBe(0);
      expect(dispatch.stdout.toString()).toBe("");

      // An unrelated dispatcher is likewise admitted.
      expect(run({ session_id: "implement" }).stdout.toString()).toBe("");

      // A call from INSIDE a subagent names a real implementing actor and carries the full rule.
      expect(run({ session_id: "unrelated", agent_id: "impl1" }).stdout.toString()).toBe("");
      // ...including reviewer != implementer, which binds at both levels.
      expect(run({ session_id: "review" }).stdout.toString()).toContain("review and implementation actors must differ");

      // ...and approver != implementer, which the dispatch case deliberately does not enforce. It is
      // only reachable when the receipt's approver is itself a subagent, since a conversation-level
      // call is always a dispatcher. `session_id: "approve", agent_id: "a1"` composes to
      // "approve#a1", which is why an approval taken in a subagent and one taken in its parent
      // conversation are distinguishable at all.
      writeFileSync(join(root, ".planning", ".state", "review.json"), JSON.stringify({
        workflow: "opaque-native-extension", plan_file: planFile, plan_hash: hash,
        approved_session_id: "approve#a1", approved_at: "2026-07-30T10:00:00.000Z",
        status: "APPROVED", reviewer_session_id: "review", reviewed_at: "2026-07-30T11:00:00.000Z",
      }));
      expect(run({ session_id: "approve", agent_id: "a1" }).stdout.toString()).toContain("approval and implementation actors must differ");
      expect(run({ session_id: "approve", agent_id: "a2" }).stdout.toString()).toBe("");

      // No usable payload identity is a DENY, never a default.
      expect(run({}).stdout.toString()).toContain("a valid actor identity and role are required");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("uses hidden review state for all built-ins", () => {
    for (const workflow of ["ds", "dev", "work", "writing", "workshop", "workflow-creator"]) {
      const policy = workflowFromArg(["--workflow", workflow]);
      expect(policy?.workflow).toBe(workflow);
      expect(policy?.reviewerVerdict).toBe(".planning/.state/review.json");
    }
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
