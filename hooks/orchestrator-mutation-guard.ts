#!/usr/bin/env bun
import { aliasRejectionReason, allowedNativePlanPath, hasUnsafeCompoundCommand, projectRelativePath } from "./_path_safety.ts";
import { classifyBashMutation } from "./_bash_mutation.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, denyOnCrash, readPayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("ORCHESTRATOR MUTATION GUARD");
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
  // projectRelativePath canonicalizes every ancestor and the leaf and rejects hardlink aliasing;
  // the previous `safeProjectPath(...).slice(cwd.length + 1)` reasoned about an uncanonicalized
  // string. Schema-v2 routing (origin/main) selects the generated-plan layout by approvalMode.
  const relative = projectRelativePath(cwd, raw);
  if (!relative) return false;
  // Fixed schema-v1 external workflows retain their descriptor-declared legacy artifact layout.
  const generatedPlan = policy.approvalMode !== "external-fixed-v1";
  if (generatedPlan && (RETIRED_MODERN_ARTIFACTS.has(relative) || relative.startsWith(".planning/.state/"))) return false;
  return policy.allowedOrchestratorDirectories.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`));
}
/**
 * Every write-capable tool, not just the two that were listed.
 *
 * `MultiEdit` and `NotebookEdit` were both absent, so both fell past this branch to the final
 * `allow()` — main chat could edit any project file by reaching for either. Three sibling hooks
 * (`writing-precis-guard`, `workshop-phase-gate-guard`, `cite-fidelity-lint`) already matched
 * MultiEdit; this one and `implementer-identity-gate` were the two that did not.
 */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
if (WRITE_TOOLS.has(tool)) {
  // NotebookEdit names its target `notebook_path`; every other write tool uses `file_path`.
  const target = tool === "NotebookEdit" ? input.notebook_path : input.file_path;
  if (payload.permission_mode === "plan" && allowedNativePlanPath(target)) allow();
  if (policy.workflow !== "ds") {
    // A hard link or symlink escape reaches here too; naming the permitted directories for a file
    // that is already inside one reads as a permitted-list bug whose obvious fix reopens the escape.
    if (!allowedPath(target)) deny(aliasRejectionReason(cwd, target)
      ?? "DELEGATION VIOLATION: main chat may only Write/Edit canonical paths under .planning or .claude; delegate all project mutations.");
  } else {
    const path = String(target ?? "");
    const ext = [".py", ".ipynb", ".R", ".r", ".sas", ".sql", ".qmd"];
    // Administrative locations are compatibility exceptions, never permission to write analysis code.
    if (ext.some(suffix => path.endsWith(suffix))) deny("Iron Law: no analysis code in main chat. Use the shared ready-wave implementation workflow.");
    if (!allowedPath(path)) deny(aliasRejectionReason(cwd, path)
      ?? "Orchestrator mutation enforcement: use delegated implementation for non-planning project mutations.");
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
/**
 * ds/dev/work orchestration runs real commands — tests, checks, compilers — so it cannot use the
 * named-command allowlist above. It gets the denylist classifier instead.
 *
 * This branch is what closes the Bash side door. Before it existed, `dev` and `work` had NO Bash
 * branch at all and admitted every mutation technique measured (18/18); `ds` admitted 10/18,
 * because its checks only rejected redirection and a handful of Python keywords, leaving `cp`,
 * `mv`, `rm`, `sed -i`, `perl -i`, `dd`, `install`, `touch`, `chmod`, and `node -e` wide open.
 *
 * `classifyBashMutation` is a denylist, not a decision procedure: read its header for the residue
 * it cannot catch (opaque executables such as `make` or `./build.sh`).
 */
if (tool === "Bash" && ["ds", "dev", "work"].includes(policy.workflow)) {
  const command = String(input.command ?? "").trim();
  const readOnlyGit = /^git (?:status|diff|log|show|rev-parse|ls-files)(?: [A-Za-z0-9._/@:=+-]+)*$|^git branch --show-current$/;
  const dsCheck = /^bash scripts\/check-all-ds\.sh(?: (?:\.|[A-Za-z0-9][A-Za-z0-9._/-]*))?$/;
  // ds keeps its pre-existing, stricter shape: no chaining or redirection of any kind, git and
  // bash reduced to two named read-only forms, and no inline analysis code.
  if (policy.workflow === "ds") {
    if (hasUnsafeCompoundCommand(command) || /[<>\n\r]/.test(command)) deny("Orchestrator Bash enforcement rejects chaining, redirection, and substitution; use one reviewed orchestration command at a time.");
    if (command.startsWith("git ") && !readOnlyGit.test(command)) deny("Orchestrator Bash enforcement permits only explicit read-only Git subcommands.");
    if (command.startsWith("bash ") && !dsCheck.test(command)) deny("Orchestrator Bash enforcement permits only the named read-only DS check script.");
    if (readOnlyGit.test(command) || dsCheck.test(command)) allow();
    if (["python3 -c", "pixi run python", "import pandas", "import numpy"].some(keyword => command.includes(keyword))) deny("Iron Law: no analysis code in main chat. Use the shared ready-wave implementation workflow.");
  } else if (readOnlyGit.test(command)) allow();
  // dev/work orchestration legitimately runs test and check commands with pipes and `2>&1`, so a
  // blanket ban on chaining would cost far more than it buys. The classifier splits the command
  // line and judges each simple command instead, which still catches `x && cp a b` and `x | tee f`.
  const mutation = classifyBashMutation(command);
  if (mutation.mutating) deny(`DELEGATION VIOLATION: main chat may not mutate project files through Bash — the command ${mutation.reason}. Delegate the change to an implementation agent.`);
}
allow();
