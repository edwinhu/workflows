#!/usr/bin/env bun
/**
 * approver != implementer, enforced where the implementer's identity actually exists.
 *
 * WHY THIS IS A SEPARATE, PLUGIN-WIDE HOOK
 *   `approved-artifact-gate` fires on the DISPATCHING call — the conversation's `Agent`/`Workflow`
 *   tool call. That payload carries no `agent_id`, because the implementer subagent has not been
 *   created yet, so the dispatcher is the only identity available there. Treating the dispatcher as
 *   the implementer makes approver == implementer structurally true in single-conversation /dev and
 *   forces the rule to be abandoned. The implementer's own identity first appears on ITS OWN tool
 *   calls, which carry a distinct `agent_id` (real captured example: "a850df8db797eebd9") alongside
 *   `agent_type`.
 *
 *   Reaching those calls requires a plugin-level hook. Skill-scoped hooks do NOT propagate into
 *   dispatched subagents — measured directly: with the same handler wired both in a skill and in
 *   settings, the settings copy fired for the parent AND for the subagent's Bash call, the skill
 *   copy fired only for the parent. That is also why `orchestrator-mutation-guard`, wired at skill
 *   scope, cannot be the backstop for anything: it is absent from subagents, and absent entirely
 *   from any conversation that is not currently inside one of the wired skills.
 *
 * WHY THE CONVERSATION-LEVEL CASE IS GATED HERE TOO
 *   An earlier revision allowed EVERY conversation-level mutation before comparing identities, on
 *   the theory that `orchestrator-mutation-guard` owned that case. It does not: being skill-scoped,
 *   it is simply not loaded once the conversation leaves the skill, and it was never wired for
 *   `work` at all. The approving conversation could therefore Write/Edit arbitrary project code
 *   directly. So the rule here is identity-first: an actor that is the recorded approver or
 *   reviewer is held to the orchestrator's own narrow write surface no matter which tool it uses,
 *   while a conversation-level actor that is NEITHER is left alone — that is an ordinary third
 *   party and this gate has nothing to say about it.
 *
 * WHY `Bash` IS DENIED OUTRIGHT FOR A RESTRICTED ACTOR, WITH NO ALLOWLIST AT ALL
 *   Matching only `Write|Edit|MultiEdit|NotebookEdit` left `echo payload > src/a.js` completely
 *   ungated, so Bash was gated by a denylist of mutating command shapes. That denylist did not
 *   converge: four rounds of enumeration produced four rounds of fresh live ALLOWs, ending with 34
 *   of 35 attempted evasions admitted in one sweep (`{ rm f; }`, `then rm f`, `git -C . checkout`,
 *   `python3 <<'EOF'`, `uv run rm f`, `unlink f`, ...). Inverting it to a positive allowlist did not
 *   converge either — it only RELOCATED the same undecidable enumeration four more times: command
 *   names (round 5), then per-command flag names (round 6), then flag ARITY (round 7), then `--`
 *   semantics and "which operands are code" (round 7's review). Each round closed one dimension and
 *   the next adversarial pass found the adjacent one. The round-7 residue was still live RCE:
 *   `npm run outer -- --node-options=--require=/tmp/evil.js` (through the SANCTIONED `--` spelling,
 *   because the target script is itself an npm invocation), `uv run --with ./evilpkg`,
 *   `pytest /tmp/evil_test.py`, `python3 -m json.tool in.json VICTIM`,
 *   `python3 -m pytest --junitxml=VICTIM`. All measured, not argued.
 *
 *   "Does this command line write, or execute something that writes?" is not decidable from the
 *   text, and eight rounds established that no partition of the text converges. So the question is
 *   no longer asked. A RESTRICTED actor — one whose identity is the receipt's approver or reviewer —
 *   gets NO Bash. Not a short list, not read-only commands, not `git status`. There is no command
 *   text this hook reads, so there is no next dimension for a review to relocate the hole into.
 *
 *   THE COST IS REAL AND IS NOT HIDDEN. `references/constraints/delegation-law.md` lists "Run test
 *   commands (verification)" and "Run git commands" as ALLOWED in main chat, and `dev-verify` step 3
 *   tells the orchestrator to run the mechanical floor and the full suite itself. Post-approval the
 *   main conversation IS the approver, so both now require a dispatched agent that runs the suite
 *   and returns its raw output. One caller cannot be delegated at all: `scripts/goal-self-send.ts`
 *   delivers `/goal` into the CALLER'S OWN session (it matches `CLAUDE_CODE_SESSION_ID` exactly and
 *   exits `unsafe_identity` otherwise), and `beat-implement` states outright that a spawned agent
 *   never runs it. That flow falls back to its already-specified degraded path — print the literal
 *   `/goal` line and let the user type it. See `tests/restricted-actor-bash.test.mjs`, which keeps
 *   the bill itemized.
 *
 *   Identity and lifecycle are still resolved FIRST — not because the command text could otherwise
 *   decide anything (nothing reads it now), but because an unresolvable identity must still deny.
 *
 * BECAUSE IT IS PLUGIN-WIDE IT MUST BE INERT BY DEFAULT.
 *   It no-ops unless the call is a mutation, in a project whose canonical receipt authenticates its
 *   selected plan, and that receipt is APPROVED. Inside such a project it fails CLOSED: an identity
 *   it cannot resolve is a denial, never a silent allow.
 */
import { classifyPlanningLifecycle, hookActorIdentity, isSubagentPayload } from "../workflows/lib/approved-artifact.ts";
import { aliasRejectionReason, allowedNativePlanPath, projectRelativePath } from "./_path_safety.ts";
import { builtInOrchestratorDirectories } from "./_workflow_policies.ts";
import { reviewerDispatchedImplementer } from "./lineage.ts";
import { allow, deny, readPayload } from "./_gate_common.ts";

/**
 * Every tool that can land bytes in a file.
 *
 * `MultiEdit` was missing from this set AND from the `hooks.json` matcher.
 *
 * The mechanism is NOT the one an earlier revision of this comment asserted. Per the hooks
 * reference, a matcher containing only letters, digits, `_`, `-`, spaces, `,` and `|` is an EXACT
 * string match — a list of exact tool names separated by `|` — and only a matcher containing some
 * OTHER character is treated as an unanchored JavaScript regular expression. `Edit|Write|
 * NotebookEdit|Bash` is therefore the exact set {Edit, Write, NotebookEdit, Bash}; its `Edit`
 * alternative did NOT match the substring inside `MultiEdit`, and the hook was never invoked for
 * `MultiEdit` at all. So the failure was "hook not called", not "called and fell through to
 * `allow()`" — a strictly worse position, because no hook output existed to inspect. Measured: a
 * MultiEdit of `src/a.ts` from the approving conversation under an APPROVED receipt landed with no
 * gate decision recorded, while the identical `Edit` was denied.
 *
 * The fix is therefore in two places and needs both: this set, and every matcher that wires a
 * mutation guard. A matcher that omits a tool name cannot be rescued by a branch in the hook.
 */
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * The one Bash denial, for every restricted actor and every command.
 *
 * It has to say THREE things or it gets misread as a bug. (1) Which rule fired — the reader's first
 * hypothesis for a denied `git status` is a broken allowlist, and "fixing" that reopens eight rounds
 * of holes, so the message states there is no allowlist to widen. (2) That running tests is included,
 * because `dev-verify` step 3 and `delegation-law.md` both say the orchestrator runs the suite, and
 * an unexplained denial there reads as a contradiction rather than a deliberate cost. (3) What to do
 * instead, in one concrete move.
 */
function bashDenial(who: string): never {
  return deny(
    `IMPLEMENTER IDENTITY GATE (${receipt.workflow}): ${who}, so it may not execute commands under it. ` +
    `A restricted actor gets NO Bash — this is not an allowlist with a gap, and no rewording of the command ` +
    `will pass: read-only commands, \`git status\`, and TEST RUNS are all refused here. ` +
    `Dispatch a separate agent to run it and return the raw output; that agent is unrestricted. ` +
    `If the command must run in THIS session and cannot be delegated (\`/goal\` activation via ` +
    `scripts/goal-self-send.ts is the known case), hand the literal command to the user instead.`,
  );
}

const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
if (!FILE_TOOLS.has(tool) && tool !== "Bash") allow();

// Authority comes from the receipt, never from a visible planning file.
const cwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();
const lifecycle = classifyPlanningLifecycle(cwd);
if (lifecycle.kind !== "canonical") allow();
const receipt = lifecycle.resolved.receipt;
// Before APPROVED there is no implementation to gate, and the reviewer subagent is still writing
// its own receipt — `reviewer-verdict-guard` owns that call.
if (receipt.status !== "APPROVED") allow();

// IDENTITY IS THE ONLY THING RESOLVED. The command is not read, here or anywhere below.
//
// An earlier revision classified the Bash command FIRST and allowed on a clean classification, ahead
// of both this check and the actor comparison below. That ordering converted every miss in
// `_bash_mutation.ts` — a denylist over an undecidable question — into a full bypass of the gate,
// and it allowed a payload carrying NO identity at all as long as the command happened to look
// clean (measured: an identity-less payload running `make install` inside a governed project with an
// APPROVED receipt was allowed). Round 8 removed the classification step entirely rather than
// merely re-ordering it, so there is no longer a reading of the command that could be moved back in
// front of this. An unresolvable identity still denies: the failure mode this guards against is
// "actor unknown", which no amount of command text can answer.
const actor = hookActorIdentity(payload);
if (actor === null) {
  deny(`IMPLEMENTER IDENTITY GATE (${receipt.workflow}): this mutation carries no usable actor identity, so it cannot be separated from the approving and reviewing actors. Re-dispatch the work through the approved implementation lifecycle.`);
}

const isApprover = actor === receipt.approved_session_id;
const isReviewer = actor === receipt.reviewer_session_id;

/**
 * THE COMMAND TEXT IS NEVER READ. That absence is the mechanism, not an omission.
 *
 * Rounds 5-7 each admitted Bash on a positive reading of the command, and each reading was defeated
 * by the next one: a name allowlist by unenumerated flags, a flag allowlist by wrong arities, an
 * arity table by `--` and by operands that are themselves code. Every admission rule needs a
 * complete model of every tool it names, and no such model exists. So there is no `command` variable
 * below, and no branch that could grow one.
 */
if (!isSubagentPayload(payload)) {
  // A conversation-level actor that neither approved nor reviewed this plan is an ordinary third
  // party: it is not the actor this rule separates, and denying it would deny unrelated work.
  if (!isApprover && !isReviewer) allow();
  // The approver/reviewer speaking at conversation level IS the orchestrator. It keeps exactly the
  // orchestrator's write surface — planning and configuration paths, plus native plan files in plan
  // mode — and nothing else. Anything wider is the bypass this gate exists to close.
  if (FILE_TOOLS.has(tool)) {
    const target = tool === "NotebookEdit" ? input.notebook_path : input.file_path;
    if (payload.permission_mode === "plan" && allowedNativePlanPath(target)) allow();
    const relative = projectRelativePath(cwd, target);
    const permitted = builtInOrchestratorDirectories(receipt.workflow);
    if (relative !== null && permitted.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) allow();
    // A hard link or a symlink escape also lands here with `relative === null`, and rendering it as
    // "may only write .planning, .claude" names the directory the file is ALREADY IN. Say which
    // rule fired, or the denial reads as a permitted-list bug whose obvious fix reopens the escape.
    const alias = aliasRejectionReason(cwd, target);
    deny(`IMPLEMENTER IDENTITY GATE (${receipt.workflow}): this conversation ${isApprover ? "approved" : "reviewed"} ${receipt.plan_file} and may not also implement it. ${alias ?? `The orchestrator may only write ${permitted.join(", ")}`}; delegate project mutations to a separate implementation agent.`);
  }
  // Bash carries no reliable target path and whether a command writes is undecidable, so the
  // approving or reviewing conversation gets NO commands — including read-only ones and test runs.
  deny(bashDenial(`this conversation ${isApprover ? "approved" : "reviewed"} ${receipt.plan_file}`));
}

if (isApprover) {
  if (tool === "Bash") deny(bashDenial(`this actor approved ${receipt.plan_file}`));
  deny(`IMPLEMENTER IDENTITY GATE (${receipt.workflow}): approval and implementation actors must differ. This actor approved ${receipt.plan_file} and may not also implement it; dispatch the work to a separate implementation agent.`);
}
if (isReviewer) {
  if (tool === "Bash") deny(bashDenial(`this actor reviewed ${receipt.plan_file}`));
  deny(`IMPLEMENTER IDENTITY GATE (${receipt.workflow}): review and implementation actors must differ. This actor reviewed ${receipt.plan_file} and may not also implement it; dispatch the work to a separate implementation agent.`);
}
// A fresh subagent dispatched BY the reviewer satisfies identity inequality while leaving the
// reviewer in control of the work end to end. This is the only ancestry the gate looks at, it reads
// UNDOCUMENTED on-disk layout, and it FAILS OPEN on anything it cannot resolve — lineage.ts is
// monitored telemetry, not a control, and nothing here may claim lineage separation as an invariant.
if (reviewerDispatchedImplementer(payload, receipt.reviewer_session_id)) {
  deny(`IMPLEMENTER IDENTITY GATE (${receipt.workflow}): the actor that reviewed ${receipt.plan_file} dispatched this implementer, so review and implementation are not separated in fact. Dispatch implementation from outside the review.`);
}
allow();
