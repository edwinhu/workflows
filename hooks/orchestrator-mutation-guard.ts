#!/usr/bin/env bun
import { hasUnsafeCompoundCommand, safeProjectPath } from "./_path_safety.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, readPayload } from "./_gate_common.ts";
const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Orchestrator mutation guard requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy."); }
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
const IMMUTABLE_APPROVAL_ARTIFACTS = new Set([
  ".planning/PLAN.md",
  ".planning/PLAN.meta.json",
  ".planning/PLAN_REVIEWED.md",
]);
function allowedPath(raw: unknown): boolean {
  const path = safeProjectPath(cwd, raw);
  if (!path) return false;
  const relative = path.slice(cwd.endsWith("/") ? cwd.length : cwd.length + 1);
  if (["writing", "workshop", "workflow-creator"].includes(policy.workflow) && IMMUTABLE_APPROVAL_ARTIFACTS.has(relative)) return false;
  return policy.allowedOrchestratorDirectories.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));
}
if (tool === "Write" || tool === "Edit") {
  if (policy.workflow !== "ds") {
    if (!allowedPath(input.file_path)) deny("DELEGATION VIOLATION: main chat may only Write/Edit canonical paths under .planning or .claude; delegate all project mutations.");
  } else {
    const path = String(input.file_path ?? "");
    const ext = [".py", ".ipynb", ".R", ".r", ".sas", ".sql", ".qmd"];
    // Administrative locations are compatibility exceptions, never permission to write analysis code.
    if (ext.some(suffix => path.endsWith(suffix))) deny("Iron Law: no analysis code in main chat. Use the shared ready-wave implementation workflow.");
    if (!allowedPath(path)) deny("Orchestrator mutation enforcement: use delegated implementation for non-planning project mutations.");
  }
  allow();
}
if (tool === "Bash" && ["writing", "workshop", "workflow-creator"].includes(policy.workflow)) {
  const command = String(input.command ?? "").trim();
  if (hasUnsafeCompoundCommand(command) || /[<>\n\r]|\$\(|`/.test(command)) deny("Orchestrator Bash enforcement rejects chaining, redirection, and substitution; delegate mutations instead.");
  const readOnly = /^(?:git (?:status|diff|log|show|rev-parse|ls-files)(?: [A-Za-z0-9._/@:=+\-,]+)*|git branch --show-current|rg(?: [A-Za-z0-9._/@:=+\-,*?\[\](){}'"|\\]+)*|fd(?: [A-Za-z0-9._/@:=+\-,*?\[\](){}'"|\\]+)*|bun scripts\/workshop\/workshop-slide-table\.ts [A-Za-z0-9._/@:=+\-,]+ --json|bun [A-Za-z0-9._/@:=+\-,]*scripts\/wc\/workflow-plan-compiler\.ts [A-Za-z0-9._/@:=+\-,]+ --project [A-Za-z0-9._/@:=+\-,]+ --json|bun test(?: [A-Za-z0-9._/@:=+\-,]+)*|bash scripts\/check-hooks\.sh|bun scripts\/parity\.ts(?: --all| [A-Za-z0-9._-]+)*|python3 tests\/workflow_return_shape_test\.py|claude plugin validate [A-Za-z0-9._/@:=+\-,]+|git diff --check)$/;
  if (!readOnly.test(command)) deny("DELEGATION VIOLATION: writing/workshop orchestration permits only named read-only checks and compilers in Bash; delegate all other commands.");
  allow();
}
if (tool === "Bash" && policy.workflow === "ds") {
  const command = String(input.command ?? "").trim();
  if (hasUnsafeCompoundCommand(command) || /[<>\n\r]/.test(command)) deny("Orchestrator Bash enforcement rejects chaining, redirection, and substitution; use one reviewed orchestration command at a time.");
  const readOnlyGit = /^git (?:status|diff|log|show|rev-parse|ls-files)(?: [A-Za-z0-9._/@:=+-]+)*$|^git branch --show-current$/;
  const dsCheck = /^bash scripts\/check-all-ds\.sh(?: (?:\.|[A-Za-z0-9][A-Za-z0-9._/-]*))?$/;
  if (command.startsWith("git ") && !readOnlyGit.test(command)) deny("Orchestrator Bash enforcement permits only explicit read-only Git subcommands.");
  if (command.startsWith("bash ") && !dsCheck.test(command)) deny("Orchestrator Bash enforcement permits only the named read-only DS check script.");
  if (readOnlyGit.test(command) || dsCheck.test(command)) allow();
  if (["python3 -c", "pixi run python", "import pandas", "import numpy"].some(keyword => command.includes(keyword))) deny("Iron Law: no analysis code in main chat. Use the shared ready-wave implementation workflow.");
}
allow();
