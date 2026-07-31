#!/usr/bin/env bun
import { lstatSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { canonicalExisting, canonicalPossiblyMissing, contained, hasUnsafeCompoundCommand, safeProjectPath } from "./_path_safety.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, readPayload } from "./_gate_common.ts";
const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Orchestrator mutation guard requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy."); }
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
// Modern workflows have one hidden, hook-owned receipt and one receipt-selected generated plan.
// Visible predecessor artifacts are conversion input, never a second authority or a writable target.
const RETIRED_MODERN_ARTIFACTS = new Set([
  ".planning/PLAN.md",
  ".planning/PLAN.meta.json",
  ".planning/PLAN_REVIEWED.md",
  ".planning/STATE.md",
  ".planning/SPEC.md",
  ".planning/LEARNINGS.md",
  ".planning/ACTIVE_WORKFLOW.md",
  ".planning/HANDOFF.md",
  ".planning/PROGRESS.md",
  ".planning/progress.md",
  ".planning/REVIEW_STATE.md",
  ".planning/VERIFY_STATE.md",
  ".planning/HUMAN_REVIEW.md",
  ".planning/IMPLEMENT_COMPLETE.md",
  ".planning/BACKLOG.md",
  ".planning/EXPLORATION.md",
  ".planning/SPEC_REVIEWED.md",
]);
function allowedPath(raw: unknown): boolean {
  const path = safeProjectPath(cwd, raw);
  if (!path) return false;
  const relative = path.slice(cwd.endsWith("/") ? cwd.length : cwd.length + 1);
  // Descriptor-v1 external workflows retain the descriptor-declared legacy artifact layout.
  const builtInModern = policy.approvalPolicy === undefined;
  if (builtInModern && (RETIRED_MODERN_ARTIFACTS.has(relative) || relative.startsWith(".planning/.state/"))) return false;
  return policy.allowedOrchestratorDirectories.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));
}
function allowedNativePlanPath(raw: unknown): boolean {
  if (typeof raw !== "string" || !isAbsolute(raw) || raw.includes("\\")) return false;
  const configDir = resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
  const plansDir = join(configDir, "plans");
  const target = resolve(raw);
  if (dirname(target) !== plansDir || extname(target) !== ".md") return false;

  const canonicalConfig = canonicalExisting(configDir);
  const canonicalPlans = canonicalExisting(plansDir);
  const canonicalTarget = canonicalPossiblyMissing(target);
  if (!canonicalConfig || !canonicalPlans || !canonicalTarget) return false;
  try {
    if (!statSync(configDir).isDirectory() || !statSync(plansDir).isDirectory()) return false;
  } catch { return false; }
  if (dirname(canonicalPlans) !== canonicalConfig || !contained(canonicalPlans, canonicalTarget) || dirname(canonicalTarget) !== canonicalPlans) return false;

  try {
    const leaf = lstatSync(target);
    return leaf.isFile() && !leaf.isSymbolicLink();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}
if (tool === "Write" || tool === "Edit") {
  if (payload.permission_mode === "plan" && allowedNativePlanPath(input.file_path)) allow();
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
