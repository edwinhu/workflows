#!/usr/bin/env bun
import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { aliasRejectionReason, allowedNativePlanPath, hasUnsafeCompoundCommand, projectRelativePath, safeExactTarget } from "./_path_safety.ts";
import { GOVERNANCE_MARKER, governedRoot } from "./lib/governance-marker.ts";
import { classifyBashMutation } from "./_bash_mutation.ts";
import { readEpisodeState } from "./lib/episode-state.ts";
import { NATIVE_PLAN_NAME } from "./lib/unbound-plan.ts";
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
/**
 * EVERY PATH JUDGEMENT IS MADE AGAINST THE GOVERNED ROOT, NOT THE SESSION DIRECTORY.
 *
 * `projectRelativePath(cwd, ...)` answers about `cwd`, and Claude Code reports the SESSION cwd —
 * which is a subdirectory whenever the user opened the project from one. Measured on this diff by
 * the gemini adapter and reproduced: from `<root>/src`, a write to `<root>/.planning/notes.md`
 * relativizes to `../.planning/notes.md`, fails containment, and is DENIED as a delegation
 * violation. The orchestrator could not write its own planning notes, and the denial named the
 * permitted directories for a file that was already inside one — a message whose obvious fix
 * reopens the escape.
 *
 * `episode-phase` already made exactly this correction for exactly this reason; two hooks disagreeing
 * about where the project is, is how a governed episode ends up half-enforced.
 * `?? cwd` keeps every ungoverned and every skill-scoped-in-an-unmarked-project case unchanged.
 */
const governed = governedRoot(cwd);
const projectDir = governed ?? cwd;

/**
 * Every write-capable tool, not just the two that were listed.
 *
 * `MultiEdit` and `NotebookEdit` were both absent, so both fell past this branch to the final
 * `allow()` — main chat could edit any project file by reaching for either. Three sibling hooks
 * (`writing-precis-guard`, `workshop-phase-gate-guard`, `cite-fidelity-lint`) already matched
 * MultiEdit; this one and `implementer-identity-gate` were the two that did not.
 */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// NotebookEdit names its target `notebook_path`; every other write tool uses `file_path`.
const target = tool === "NotebookEdit" ? input.notebook_path : input.file_path;

/**
 * FORGING A GENERATED PLAN: writing the approval machinery's OWN filename shape into `.planning/`.
 *
 * MEASURED 2026-08-06, IN THE FIRST END-TO-END `/writing` RUN THIS REPO HAS EVER HAD. Zero
 * `EnterPlanMode` calls, zero `ExitPlanMode` calls — and a plan document produced by `Write`ing
 * `.planning/ancient-doodling-meerkat.md`, three lowercase words in native Plan mode's own
 * namespace. The episode then proceeded as though it had planned. `approved-artifact-persist` only
 * writes a receipt on an OBSERVED `ExitPlanMode` (`approved-artifact-persist.ts:40`), so no receipt
 * could exist; `approved-artifact-gate` then correctly refused every implementer; and nothing told
 * the episode to go back. A deadlock, reached entirely through moves this guard permitted.
 *
 * WHY THE WHOLE DIRECTORY IS NOT CLOSED. `.planning` is an allowed orchestrator directory for all
 * six workflows and must stay one: the beats write real notes there. The one thing that may not be
 * written is the name shape the approval machinery generates and that `unboundGeneratedPlan` later
 * looks for — because a file with that name asserts an approval that never happened.
 *
 * `NATIVE_PLAN_NAME` IS IMPORTED, NEVER RESTATED. The write gate and the turn-end detector must
 * recognise the same shape; two copies of a regex is how they drift apart, and a drift here means
 * the gate denies a name the detector ignores, or worse, the reverse.
 *
 * PLAN MODE IS EXEMPT, AND THAT IS THE POINT RATHER THAN A HOLE. With `plansDirectory:
 * "./.planning"` — the precondition for the entire receipt chain
 * (`scripts/ensure-plans-directory.ts`) — the GENUINE generated plan is written into this directory
 * by the model while `permission_mode` is `plan`. Denying that would close the legitimate route and
 * leave the shortcut as the only one. `allowedNativePlanPath` cannot answer this: it authorizes
 * `~/.claude/plans` only, which is the layout a governed project deliberately does not use.
 *
 * The residue — enter Plan mode, write the file, never call `ExitPlanMode` — is closed at the other
 * end: no receipt binds it, so `unboundGeneratedPlan` names it and the turn-end gate refuses. The
 * shortcut becomes LOUD rather than silent, which is all this pair was ever able to promise.
 */
function refuseGeneratedPlanForgery(): void {
  if (!WRITE_TOOLS.has(tool) || payload.permission_mode === "plan") return;
  const relative = projectRelativePath(projectDir, target);
  if (!relative) return;
  const segments = relative.split("/");
  if (segments.length !== 2 || segments[0] !== ".planning" || !NATIVE_PLAN_NAME.test(segments[1])) return;
  deny(`APPROVAL VIOLATION: ${relative} is a native generated-plan filename, and writing one by hand asserts an approval that never happened. A plan is created by planning: enter Plan mode and approve it with ExitPlanMode, which is the only event that writes the receipt every implementer gate reads. Ordinary notes in .planning are fine — just not this name shape.`);
}

const argv = Bun.argv.slice(2);
let policy = workflowFromArg(argv);
if (!policy && argv.includes("--workflow")) {
  deny("Orchestrator mutation guard requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy.");
}
if (!policy) {
  if (governed === undefined) allow();                    // ungoverned project: untouched.
  const state = readEpisodeState(governed);
  if (state === null || state.exit) {
    // NO IN-FLIGHT EPISODE MEANS NO DELEGATION BOUNDARY TO ENFORCE — BUT THE PLAN NAMESPACE IS NOT
    // PART OF THAT BOUNDARY. Found by the gemini adapter on this diff and reproduced: a governed
    // project whose episode has not been recorded yet (CLARIFY has not happened, or the episode
    // exited) fell straight to `allow()` and the forgery check below was never reached. Forging the
    // plan BEFORE the episode exists is the easiest version of the same shortcut, so the one denial
    // that does not depend on knowing which workflow this is, is made before standing down.
    refuseGeneratedPlanForgery();
    allow();
  }
  policy = workflowFromPlanningEvidence(governed, state.workflow);
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
  const relative = projectRelativePath(projectDir, raw);
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

if (WRITE_TOOLS.has(tool)) {
  if (payload.permission_mode === "plan" && allowedNativePlanPath(target)) allow();
  // Only `Write`. `Edit`/`MultiEdit` on the marker are modifications by definition, and
  // `NotebookEdit` cannot produce this file at all.
  if (tool === "Write" && adoptsGovernance(target, input.content)) allow();
  // BEFORE the ds/non-ds split, because both branches reach `allowedPath` and both would otherwise
  // admit the forgery — and because this denial has to name the remedy, which the generic
  // delegation messages below cannot.
  refuseGeneratedPlanForgery();
  if (policy.workflow !== "ds") {
    // A hard link or symlink escape reaches here too; naming the permitted directories for a file
    // that is already inside one reads as a permitted-list bug whose obvious fix reopens the escape.
    if (!allowedPath(target)) deny(aliasRejectionReason(projectDir, target)
      ?? "DELEGATION VIOLATION: main chat may only Write/Edit canonical paths under .planning or .claude; delegate all project mutations.");
  } else {
    const path = String(target ?? "");
    const ext = [".py", ".ipynb", ".R", ".r", ".sas", ".sql", ".qmd"];
    // Administrative locations are compatibility exceptions, never permission to write analysis code.
    if (ext.some(suffix => path.endsWith(suffix))) deny("Iron Law: no analysis code in main chat. Use the shared ready-wave implementation workflow.");
    if (!allowedPath(path)) deny(aliasRejectionReason(projectDir, path)
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
