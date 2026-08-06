#!/usr/bin/env bun
import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { aliasRejectionReason, allowedNativePlanPath, hasUnsafeCompoundCommand, projectRelativePath, safeExactTarget } from "./_path_safety.ts";
import { GOVERNANCE_MARKER, governedRoot } from "./lib/governance-marker.ts";
import { classifyBashMutation } from "./_bash_mutation.ts";
import { readEpisodeState } from "./lib/episode-state.ts";
import { workflowFromArg, workflowFromPlanningEvidence } from "./_workflow_policies.ts";
import { allow, deny, denyOnCrash, readPayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("ORCHESTRATOR MUTATION GUARD");
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());

/**
 * TWO REGISTRATIONS, BECAUSE THE BOUNDARY MUST FOLLOW THE EPISODE AND NOT THE SKILL.
 *
 * Skill-scoped (`--workflow <name>` from frontmatter) is the original and stays. Plugin-wide
 * (no argument) is the one that closes the measured hole.
 *
 * THE HOLE, MEASURED 2026-08-06 IN TWO TRANSCRIPTS.
 *   `showClearContextOnPlanAccept` is on by default. Accepting a plan therefore CLEARS CONTEXT and
 *   starts a NEW session whose entire first message is "Implement the following plan: …". No skill
 *   is loaded in that session, so no frontmatter hook is registered, so this guard did not exist —
 *   at the exact moment IMPLEMENT begins, which is the only beat it is for.
 *
 *   Session e64e6d1d (`/writing`, then `/work`) denied `git add` at 16:13:25 and denied an Edit to
 *   the manuscript at 16:21:48: the guard works. Session 8a748899 began at 16:37:23 — the same
 *   second the first ended, on plan accept — invoked NO skill, and made 32 unguarded Edits to that
 *   same manuscript with zero Agent dispatches. Nothing failed; the guard was simply absent, and
 *   absence is silent.
 *
 * WHY DERIVING IS SAFE HERE. `approved-artifact-persist` is plugin-wide for the same reason and
 * derives identity the same way. The episode record is written by a hook that OBSERVED an
 * `AskUserQuestion`, so this reads evidence rather than a model's claim about itself.
 *
 * WHY THE AMBIENT PATH REQUIRES A RECORDED EPISODE AND THE MARKER, AND THE SKILL PATH DOES NOT.
 *   Invoking a workflow skill IS the consent signal, so the skill path is unchanged in every
 *   project. The ambient path runs in every project of every user, where "absent marker means byte
 *   for byte untouched" is the invariant that must never regress — and it must not default to
 *   `work` the way `workflowFromPlanningEvidence` does with no evidence, or every governed project
 *   with no episode would start denying ordinary edits.
 */
const argv = Bun.argv.slice(2);
let policy = workflowFromArg(argv);
if (!policy && argv.includes("--workflow")) {
  deny("Orchestrator mutation guard requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy.");
}
if (!policy) {
  const root = governedRoot(cwd);
  if (root === undefined) allow();                       // ungoverned project: untouched.
  const state = readEpisodeState(root);
  if (state === null || state.exit) allow();             // no in-flight episode: nothing to bound.
  policy = workflowFromPlanningEvidence(root, state.workflow);
  if (!policy) allow();                                  // identity genuinely unknown: never guess.
}
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
 * THE ONE WRITE SURFACE THIS GUARD WIDENS: adopting governance.
 *
 * `.claude-workflows.json` is the committed opt-in that arms the transition machinery
 * (`lib/governance-marker.ts`). Without a way to create it from the conversation, `beat-clarify`
 * can only ever print a command for the user to run by hand, and an opt-in that costs a detour is
 * an opt-in nobody takes — which would leave the turn-end gate correct and unreachable.
 *
 * CREATION-ONLY AND EXACT-CONTENT ARE BOTH LOAD-BEARING, AND NEITHER IS BELT-AND-BRACES.
 *   The marker stores a BOOLEAN precisely so enforcement can be turned OFF by editing it
 *   (`governance-marker.ts:17-19`). A permit that admitted modification, or that admitted
 *   `{"governed": false}`, would therefore hand the actor a governance KILL SWITCH — a hook that
 *   lets the thing it governs write its own exemption. Adoption is a one-way door here: turning
 *   governance off stays a human edit, which is exactly the visible one-line diff the marker design
 *   asks for.
 *
 *   Content is compared as a PARSED OBJECT with an exact key set, not as a string. A byte compare
 *   would reject harmless whitespace and — worse — invite a "relax it a little" fix later; an
 *   unbounded key set would let an unrecognised field ride along into a committed file.
 */
const ADOPTION_MARKER_PATH = join(cwd, GOVERNANCE_MARKER);
function adoptsGovernance(target: unknown, content: unknown): boolean {
  if (typeof target !== "string" || !target.trim()) return false;
  // THE `..` REJECTION HAS TO HAPPEN ON THE RAW SPELLING, HERE. `safeExactTarget` makes it too, but
  // `resolve()` below would already have collapsed `..` LEXICALLY — and the kernel resolves a
  // symlink first and only then applies `..`, so the two disagree over exactly the spelling this
  // rejection exists for. Resolving before checking hands the check an answer that can be wrong.
  if (target.split(/[\\/]+/).some(part => part === "..")) return false;
  // `safeExactTarget` applies the symlink-leaf, containment and hard-link rejections; it is the same
  // primitive that authorizes the one sanctioned receipt write.
  if (!safeExactTarget(cwd, isAbsolute(target) ? target : resolve(cwd, target), ADOPTION_MARKER_PATH)) return false;
  // CREATION ONLY. `lstat`, not `existsSync`: a dangling symlink at the marker path is a file that
  // exists for this purpose, and reading it as absent would make the alias the way in.
  try { lstatSync(ADOPTION_MARKER_PATH); return false; } catch { /* absent: adoption is available */ }
  if (typeof content !== "string") return false;
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return false; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const marker = parsed as Record<string, unknown>;
  return Object.keys(marker).length === 2 && marker.schemaVersion === 1 && marker.governed === true;
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
  // Only `Write`. `Edit`/`MultiEdit` on the marker are modifications by definition, and
  // `NotebookEdit` cannot produce this file at all.
  if (tool === "Write" && adoptsGovernance(target, input.content)) allow();
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
  /**
   * THE DIAGNOSTIC SURFACE. `ls`, `cat`, `head`, `tail`, `wc`, `stat`, `file` — none of which can
   * write anything, because chaining, redirection, and command substitution are already denied on
   * the line above, and these commands have no mutating form without them.
   *
   * WHY IT IS NOT A CONVENIENCE. Measured 2026-08-04 in `rule611`: the approval receipt silently
   * failed to bind, so `approved-artifact-gate` denied Agent|Workflow and this guard denied Bash.
   * The session could read files and do nothing else — it could not `ls .planning/.state/`, could
   * not run a parser, could not dispatch a reviewer, and could not investigate why. THE GATE BLOCKED
   * THE TOOLING NEEDED TO DIAGNOSE THE GATE, and the only exit was to restart the session and lose
   * the context that made the diagnosis possible.
   *
   * A guard whose failure mode is undiagnosable from inside is worse than a slightly wider one:
   * every minute spent unable to see `.planning/.state/` is a minute the user cannot be told what
   * broke. The delegation boundary this guard defends is about MUTATION, and inspection was never
   * part of it.
   */
  const readOnly = /^(?:ls(?: [A-Za-z0-9._/@:=+\-,*?\[\]]+)*|(?:cat|head|tail|wc|stat|file)(?: [A-Za-z0-9._/@:=+\-,*?\[\]]+)+|git (?:status|diff|log|show|rev-parse|ls-files)(?: [A-Za-z0-9._/@:=+\-,]+)*|git branch --show-current|rg(?: [A-Za-z0-9._/@:=+\-,*?\[\](){}'"|\\]+)*|fd(?: [A-Za-z0-9._/@:=+\-,*?\[\](){}'"|\\]+)*|bun scripts\/workshop\/workshop-slide-table\.ts [A-Za-z0-9._/@:=+\-,]+ --json|bun [A-Za-z0-9._/@:=+\-,]*scripts\/wc\/workflow-plan-compiler\.ts [A-Za-z0-9._/@:=+\-,]+ --project [A-Za-z0-9._/@:=+\-,]+ --json|bun test(?: [A-Za-z0-9._/@:=+\-,]+)*|bash scripts\/check-hooks\.sh|bun scripts\/parity\.ts(?: --all| [A-Za-z0-9._-]+)*|python3 tests\/workflow_return_shape_test\.py|claude plugin validate [A-Za-z0-9._/@:=+\-,]+|git diff --check)$/;
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
  // ds carries ONE rule the other workflows do not: analysis belongs in a dispatched agent, not in
  // main chat. That is about WHERE analysis runs and is unrelated to how a command line is spelled,
  // so it is enforced on its own and the shared classifier handles the rest.
  //
  // It used to also ban chaining and redirection outright — inherited, never argued for. The cost
  // was measured: `pixi run pytest 2>&1 | tail -20`, `rg foo | wc -l` and `git log --oneline | head`
  // all denied under ds while dev and work allowed them, in the workflow that most wants a paged
  // test run. The classifier below already splits a command line and judges each simple command, so
  // it catches `x && cp a b` and `x | tee f` without costing the pipe.
  if (policy.workflow === "ds") {
    if (["python3 -c", "pixi run python", "import pandas", "import numpy"].some(keyword => command.includes(keyword))) deny("Iron Law: no analysis code in main chat. Use the shared ready-wave implementation workflow.");
    if (command.startsWith("bash ") && !dsCheck.test(command)) deny("Orchestrator Bash enforcement permits only the named read-only DS check script.");
    if (readOnlyGit.test(command) || dsCheck.test(command)) allow();
  } else if (readOnlyGit.test(command)) allow();
  // dev/work orchestration legitimately runs test and check commands with pipes and `2>&1`, so a
  // blanket ban on chaining would cost far more than it buys. The classifier splits the command
  // line and judges each simple command instead, which still catches `x && cp a b` and `x | tee f`.
  const mutation = classifyBashMutation(command);
  if (mutation.mutating) deny(`DELEGATION VIOLATION: main chat may not mutate project files through Bash — the command ${mutation.reason}. Delegate the change to an implementation agent.`);
}
allow();
