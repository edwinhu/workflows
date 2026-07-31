import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "orchestrator-mutation-guard.ts");
const WORKFLOWS = ["ds", "dev", "writing", "workshop", "workflow-creator"];

function run({ cwd, configDir, homeDir = process.env.HOME, workflow = "writing", workflowPolicy, tool = "Write", permissionMode = "plan", filePath }) {
  const toolInput = tool === "Edit"
    ? { file_path: filePath, old_string: "old", new_string: "new" }
    : { file_path: filePath, content: "# Native plan\n" };
  const payload = {
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: toolInput,
    permission_mode: permissionMode,
    cwd,
  };
  if (permissionMode === "absent") delete payload.permission_mode;
  const env = { ...process.env, HOME: homeDir };
  if (configDir === undefined) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = configDir;
  const policyArgs = workflowPolicy ? ["--workflow-policy", workflowPolicy] : ["--workflow", workflow];
  return spawnSync("bun", [HOOK, ...policyArgs], {
    cwd,
    env,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
}

function assertAllowed(result, message) {
  assert.equal(result.status, 0, `${message}: ${result.stderr}`);
  assert.equal(result.stdout, "", message);
}

function assertDenied(result, message) {
  assert.equal(result.status, 0, `${message}: ${result.stderr}`);
  assert.match(result.stdout, /"permissionDecision": "deny"/, message);
}

const root = mkdtempSync(join(tmpdir(), "orchestrator-plan-guard-"));
const project = join(root, "project");
const config = join(root, "config");
const plans = join(config, "plans");
const outside = join(root, "outside");
mkdirSync(project);
mkdirSync(plans, { recursive: true });
mkdirSync(outside);

try {
  for (const workflow of WORKFLOWS) {
    const writeTarget = join(plans, `${workflow}-write.md`);
    assertAllowed(run({ cwd: project, configDir: config, workflow, filePath: writeTarget }), `${workflow} Plan-mode Write should be allowed`);

    const editTarget = join(plans, `${workflow}-edit.md`);
    writeFileSync(editTarget, "old");
    assertAllowed(run({ cwd: project, configDir: config, workflow, tool: "Edit", filePath: editTarget }), `${workflow} Plan-mode Edit should be allowed`);
  }

  const planTarget = join(plans, "mode-check.md");
  assertDenied(run({ cwd: project, configDir: config, permissionMode: "default", filePath: planTarget }), "native plan target should be denied outside Plan mode");
  assertDenied(run({ cwd: project, configDir: config, permissionMode: "absent", filePath: planTarget }), "native plan target should be denied when permission mode is absent");

  for (const [name, filePath] of [
    ["settings file", join(config, "settings.json")],
    ["wrong extension", join(plans, "native-plan.txt")],
    ["nested plan path", join(plans, "nested", "native-plan.md")],
    ["ordinary source path", join(project, "src", "module.ts")],
  ]) {
    assertDenied(run({ cwd: project, configDir: config, filePath }), `${name} should be denied`);
  }
  assertDenied(run({ cwd: config, configDir: config, filePath: "plans/relative.md" }), "relative native plan path should be denied");

  const outsideFile = join(outside, "escaped.md");
  writeFileSync(outsideFile, "old");
  const leafLink = join(plans, "leaf-link.md");
  symlinkSync(outsideFile, leafLink);
  assertDenied(run({ cwd: project, configDir: config, tool: "Edit", filePath: leafLink }), "symlinked plan leaf should be denied");

  const directoryLeaf = join(plans, "directory.md");
  mkdirSync(directoryLeaf);
  assertDenied(run({ cwd: project, configDir: config, tool: "Edit", filePath: directoryLeaf }), "existing non-file plan leaf should be denied");

  const escapedConfig = join(root, "escaped-config");
  mkdirSync(escapedConfig);
  symlinkSync(outside, join(escapedConfig, "plans"));
  assertDenied(run({ cwd: project, configDir: escapedConfig, filePath: join(escapedConfig, "plans", "parent-link.md") }), "symlinked plans directory escaping the config root should be denied");

  const danglingPlansConfig = join(root, "dangling-plans-config");
  mkdirSync(danglingPlansConfig);
  symlinkSync(join(root, "missing-outside"), join(danglingPlansConfig, "plans"));
  assertDenied(run({ cwd: project, configDir: danglingPlansConfig, filePath: join(danglingPlansConfig, "plans", "dangling-parent.md") }), "dangling plans symlink should be denied");

  const danglingConfig = join(root, "dangling-config");
  symlinkSync(join(root, "missing-config-target"), danglingConfig);
  assertDenied(run({ cwd: project, configDir: danglingConfig, filePath: join(danglingConfig, "plans", "dangling-config.md") }), "dangling config directory symlink should be denied");

  const fallbackHome = join(root, "fallback-home");
  const fallbackPlans = join(fallbackHome, ".claude", "plans");
  mkdirSync(fallbackPlans, { recursive: true });
  assertAllowed(run({ cwd: project, homeDir: fallbackHome, filePath: join(fallbackPlans, "fallback.md") }), "HOME/.claude/plans should be used when CLAUDE_CONFIG_DIR is unset");
  assertDenied(run({ cwd: project, homeDir: fallbackHome, filePath: join(plans, "not-fallback.md") }), "another config directory should be denied when using the HOME fallback");

  const overrideConfig = join(root, "override-config");
  const overridePlans = join(overrideConfig, "plans");
  mkdirSync(overridePlans, { recursive: true });
  assertAllowed(run({ cwd: project, configDir: overrideConfig, filePath: join(overridePlans, "override.md") }), "CLAUDE_CONFIG_DIR plan directory should be honored");
  assertDenied(run({ cwd: project, configDir: overrideConfig, filePath: join(plans, "old-config.md") }), "non-configured plan directory should not be allowed");

  const descriptorPath = join(project, ".planning", "external-policy.json");
  mkdirSync(join(project, ".planning"), { recursive: true });
  writeFileSync(descriptorPath, JSON.stringify({
    schemaVersion: 1,
    workflow: "external-v1",
    clarifySentinel: ".planning/EXTERNAL_CLARIFIED.json",
    clarifyReason: "External compatibility test",
    reviewerVerdict: ".planning/PLAN_REVIEWED.md",
    approvalPolicy: ".planning/approval-policy.json",
    allowedOrchestratorDirectories: [".planning"],
  }));
  assertAllowed(
    run({ cwd: project, configDir: config, workflowPolicy: descriptorPath, permissionMode: "default", filePath: join(project, ".planning", "PLAN.md") }),
    "external descriptor-v1 policy should retain its declared visible plan path",
  );

  const generatedDescriptorPath = join(project, ".planning", "generated-policy.json");
  writeFileSync(generatedDescriptorPath, JSON.stringify({
    schemaVersion: 2,
    workflow: "external-v2",
    approvalMode: "generated-plan-receipt-v1",
    allowedOrchestratorDirectories: [".planning"],
  }));
  assertDenied(
    run({ cwd: project, configDir: config, workflowPolicy: generatedDescriptorPath, permissionMode: "default", filePath: join(project, ".planning", "PLAN.md") }),
    "external descriptor-v2 policy should retire visible fixed plan authority",
  );
  assertAllowed(
    run({ cwd: project, configDir: config, workflowPolicy: generatedDescriptorPath, permissionMode: "default", filePath: join(project, ".planning", "notes.txt") }),
    "external descriptor-v2 policy should retain declared orchestrator directories",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("orchestrator-mutation-guard tests passed");
