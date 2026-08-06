import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const hook = join(root, "hooks", "approved-artifact-gate.ts");
function run(tool_input) {
  return spawnSync("bun", [hook, "--workflow", "workflow-creator"], { input: JSON.stringify({ tool_name: "Workflow", tool_input, cwd: "/tmp/no-plan" }), encoding: "utf8", env: { ...process.env, CLAUDE_SESSION_ID: "audit-session" } });
}
const validArgs = { auditOnly: true, readOnly: true, targetWorkflow: "demo", projectDir: "/tmp/demo", targetFiles: [{ path: "/tmp/demo/skills/demo/SKILL.md", role: "entry" }], phases: ["clarify","review"], mechanicalProbes: [], criteriaRows: [{ id: "C1", criterion: "pass", evidence: "test" }] };
describe("workflow-creator pre-plan admission", () => {
  test("admits exact read-only workflow-creator-verify", () => expect(run({ name: "workflow-creator-verify", args: validArgs }).stdout).toBe(""));
  test("denies other pre-plan workflows", () => expect(run({ name: "wc-generate", args: validArgs }).stdout).toContain('"permissionDecision": "deny"'));
  test("denies malformed or mutation-bearing workflow-creator-verify", () => {
    expect(run({ name: "workflow-creator-verify", args: { ...validArgs, readOnly: false } }).stdout).toContain('"permissionDecision": "deny"');
    expect(run({ name: "workflow-creator-verify", args: { ...validArgs, writablePaths: ["skills/demo/SKILL.md"] } }).stdout).toContain('"permissionDecision": "deny"');
    expect(run({ name: "workflow-creator-verify", args: { ...validArgs, mechanicalProbes: [{ command: "rm -rf /tmp/demo" }] } }).stdout).toContain('"permissionDecision": "deny"');
  });
  test("audit-only agents have a structural read-only tool profile", () => {
    const agent = readFileSync(join(root, "agents", "workflow-auditor.md"), "utf8");
    const workflow = readFileSync(join(root, "workflows", "workflow-creator-verify.js"), "utf8");
    expect(agent).toContain("tools: Read, Grep, Glob");
    expect(agent).not.toMatch(/tools:.*(?:Write|Edit|Bash|Agent|Workflow)/);
    expect(workflow).toContain("agentType: 'workflows:workflow-auditor'");
    expect(workflow).toContain("auditAgentOptions({ label: d.key");
  });
});
