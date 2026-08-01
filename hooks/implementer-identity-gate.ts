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
 * BECAUSE IT IS PLUGIN-WIDE IT MUST BE INERT BY DEFAULT — AND "INERT" MEANS UNGOVERNED, NOT UNREADABLE.
 *   It no-ops unless the call is a mutation in a GOVERNED project: one with a receipt surface under
 *   `.planning/.state`. Where that receipt resolves and is APPROVED, the identity rules below apply.
 *   Where it EXISTS but does not resolve, `blockedProjectDisposition` applies a reduced, fail-closed
 *   regime — because reading "I cannot classify this project" as permission made one `ln -s` a
 *   complete bypass of every rule in this file. Where there is no receipt surface at all, the hook
 *   does nothing, which is the case that must never regress: it is every project of every user.
 *   Inside a governed project it fails CLOSED: an identity it cannot resolve is a denial, never a
 *   silent allow.
 */
import { classifyPlanningLifecycle, hookActorIdentity, isSubagentPayload, parseReviewState } from "../workflows/lib/approved-artifact.ts";
import { aliasRejectionReason, allowedNativePlanPath, projectRelativePath, resolvedProjectRelativePath, safeExactTarget } from "./_path_safety.ts";
import { builtInOrchestratorDirectories } from "./_workflow_policies.ts";
import { reviewerDispatchedImplementer } from "./lineage.ts";
import { allow, deny, denyOnCrash, readPayload } from "./_gate_common.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// FIRST STATEMENT WITH AN EFFECT in this module's body, so every line of gate logic below runs
// under it. A throw after this point becomes a deny instead of an exit-1, which Claude Code would
// treat as non-blocking. It cannot cover a throw during MODULE EVALUATION of the imports above —
// ES imports are hoisted — but none of those modules execute anything at import time.
denyOnCrash("IMPLEMENTER IDENTITY GATE");

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

// Declared HERE, not next to the receipt-protection block that reads them: `blockedProjectDisposition`
// runs before that block's line is ever reached, and a `const` referenced ahead of its declaration is
// a TDZ ReferenceError — which `denyOnCrash` would turn into a deny for every blocked project.
const RECEIPT_STATE_DIRECTORY = ".planning/.state";
const RECEIPT_RELATIVE = `${RECEIPT_STATE_DIRECTORY}/review.json`;

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

/**
 * The orchestrator's write surface, shared by the canonical and the blocked branch.
 *
 * Both branches ask the identical question — "is this write inside the narrow surface an
 * orchestrator keeps?" — and an earlier revision answered it in only one of them, which is how the
 * blocked branch ended up answering "yes, everywhere". Keeping one copy means a future narrowing
 * cannot be applied to one branch and forgotten in the other.
 */
function orchestratorSurfaceOrDeny(label: string, permitted: readonly string[], preface: string): never {
  const target = tool === "NotebookEdit" ? input.notebook_path : input.file_path;
  if (payload.permission_mode === "plan" && allowedNativePlanPath(target)) allow();
  const relative = projectRelativePath(cwd, target);
  if (relative !== null && permitted.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))) allow();
  // A hard link or a symlink escape also lands here with `relative === null`, and rendering it as
  // "may only write .planning, .claude" names the directory the file is ALREADY IN. Say which
  // rule fired, or the denial reads as a permitted-list bug whose obvious fix reopens the escape.
  const alias = aliasRejectionReason(cwd, target);
  deny(`${label}: ${preface} ${alias ?? `The orchestrator may only write ${permitted.join(", ")}`}; delegate project mutations to a separate implementation agent.`);
}

/**
 * `blocked` IS MORE SUSPICION, NOT LESS. A SENTINEL MEANING "SOMETHING IS WRONG HERE" IS NOT A PERMIT.
 *
 * The call site used to read `if (lifecycle.kind !== "canonical") allow()`, which handed the same
 * blanket permission to a project with no planning state at all and to a project whose receipt
 * surface had been REPLACED. Measured before this fix, in a project with a legitimately APPROVED
 * receipt (`approved_session_id: "approver-1"`) whose `.planning/.state` was swapped for a symlink to
 * a sibling directory holding byte-identical receipt content: the recorded approver's `Write src/a.js`
 * and its `Bash rm -rf src` were BOTH allowed, at APPROVED and at PENDING. Every rule in this file —
 * receipt protection, both actor comparisons, the Bash denial — was off for as long as the symlink
 * existed, and creating it needs one `ln -s` during PENDING, when Bash is unrestricted anyway.
 *
 * THE INERTNESS THAT IS LOAD-BEARING IS `kind === "none"`, AND ONLY THAT. This hook runs on every
 * Edit/Write/MultiEdit/NotebookEdit/Bash in every project of every user, so a project that is not
 * governed must be untouched. That is what `none` means. `blocked` splits (see `hasReceiptSurface`):
 * without a receipt surface it is an ungoverned or legacy `.planning`, nothing was ever approved, and
 * it is allowed exactly as before; WITH one, the project is governed and its authority is currently
 * unreadable, which is the state this function refuses to reward.
 *
 * WHAT A GOVERNED-BUT-BROKEN PROJECT GETS
 *   - No receipt to read, so no actor can be CLEARED by identity. A conversation-level actor is
 *     therefore held to the orchestrator's own surface and gets no Bash — the same regime the
 *     approving conversation is in under a valid APPROVED receipt. This is the fail-closed choice and
 *     it is the one with a real cost: an ordinary main-chat actor in a project whose receipt merely
 *     went stale loses Bash and project writes until the state is repaired.
 *   - A dispatched subagent is still allowed, because "delegate it" has to remain true advice and
 *     because the implementer is the actor this rule was never aimed at. That is the residue: an
 *     approver re-entering as a subagent is caught only by the untrusted-receipt check below, which
 *     an attacker who controls the unreadable receipt can trivially defeat by not naming itself.
 *   - `.planning` and `.claude` stay writable — the restriction is the ORCHESTRATOR'S surface, not a
 *     stricter one — so most blocked states (a stale receipt, a malformed one) are repairable from
 *     the conversation that hit the denial. A SYMLINKED `.state` is not repairable that way, because
 *     removing a link needs `rm`; that one needs a dispatched agent or a shell outside the session.
 *
 * THE UNTRUSTED READ MAY ONLY TIGHTEN. The receipt bytes at a blocked project are exactly what
 * cannot be trusted, so they are never used to permit anything: they are read best-effort, and used
 * ONLY to deny an actor that names itself the approver or reviewer. Feeding this check attacker-chosen
 * bytes can at most deny the attacker.
 */
function blockedProjectDisposition(reason: string, governed: boolean): never {
  if (!governed) allow();
  const label = `IMPLEMENTER IDENTITY GATE (planning state blocked: ${reason})`;
  const repair =
    `The receipt at \`${RECEIPT_RELATIVE}\` exists but does not resolve, so no actor here can be shown to be ` +
    `separate from the approver. Repair the planning state — \`${RECEIPT_STATE_DIRECTORY}\` must be a real ` +
    `directory containing a receipt that authenticates its selected plan — or run the work through a ` +
    `dispatched agent, which is unrestricted.`;

  // Untrusted, best-effort, DENY-ONLY: never a source of permission. Its ONLY effect is to extend the
  // restriction to a SUBAGENT that the bytes on disk name as approver or reviewer.
  const actor = hookActorIdentity(payload);
  const named = actor === null ? null
    : untrustedReceiptField("approved_session_id") === actor ? "approved"
    : untrustedReceiptField("reviewer_session_id") === actor ? "reviewed"
    : null;
  // The implementer is not the actor this rule separates, and denying every subagent would make
  // "dispatch a separate agent" unfollowable advice in the one state that most needs it.
  if (named === null && isSubagentPayload(payload)) allow();
  const preface = named === null
    ? `No actor can be separated from the approver in this project's current state.`
    : `This actor ${named} the plan recorded here and may not also implement it.`;
  // The restriction is the ORCHESTRATOR'S, not a stricter one: a restricted actor under a valid
  // APPROVED receipt still writes `.planning` and `.claude`, and taking that away here would remove
  // the only in-session route back to a resolvable state. The permitted set is the most restrictive
  // any built-in workflow grants — the blocked receipt names a workflow, but that name is untrusted
  // and a WIDER surface is exactly what it must not be able to buy.
  if (FILE_TOOLS.has(tool)) orchestratorSurfaceOrDeny(label, [".planning", ".claude"], `${preface} ${repair}`);
  deny(`${label}: ${preface} It may not execute commands in a project whose approval state cannot be resolved. ` +
    `A restricted actor gets NO Bash — this is not an allowlist with a gap: read-only commands, \`git status\`, ` +
    `and TEST RUNS are all refused here. ${repair}`);
}

/** The receipt as it happens to read RIGHT NOW, with no safety at all. Deny-only, by construction. */
function untrustedReceiptField(field: string): string | null {
  try {
    const value = JSON.parse(readFileSync(join(cwd, ".planning", ".state", "review.json"), "utf8"));
    const found = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[field] : undefined;
    return typeof found === "string" && found.trim() ? found : null;
  } catch { return null; }
}

const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
if (!FILE_TOOLS.has(tool) && tool !== "Bash") allow();

// Authority comes from the receipt, never from a visible planning file.
const cwd = typeof payload.cwd === "string" && payload.cwd.trim() ? payload.cwd : process.cwd();
const lifecycle = classifyPlanningLifecycle(cwd);
if (lifecycle.kind === "none") allow();
if (lifecycle.kind === "blocked") blockedProjectDisposition(lifecycle.reason, lifecycle.governed);
const receipt = lifecycle.resolved.receipt;

/**
 * THE RECEIPT IS NOT PART OF ANYONE'S WRITE SURFACE — AT ANY LIFECYCLE STATUS.
 *
 * `builtInOrchestratorDirectories` returns `[".planning", ".claude"]`, and the conversation-level
 * branch below authorized any path under those prefixes. `.planning/.state/review.json` IS the
 * receipt every other check reads its authority from, so that prefix authorized writing the
 * authority itself. Measured end to end: an actor that never approved and never reviewed wrote
 * `{status: "APPROVED", approved_session_id: "nobody-approved-this", reviewer_session_id:
 * "nobody-reviewed-this"}`, this gate exited 0, and `validateGeneratedPlanArtifact` then ACCEPTED
 * the fabricated receipt — no plan approved, no reviewer dispatched. Five of six actor/status
 * combinations were admitted; the one denial was incidental (reviewer == implementer), not the
 * receipt rule.
 *
 * `orchestrator-mutation-guard` already excludes `.planning/.state/` and was assumed to be the
 * backstop. It is not: it is SKILL-SCOPED, so it never propagates into a subagent and is absent
 * from any conversation not currently inside a wired skill. This gate is the only plugin-wide
 * PreToolUse mutation hook, so the exclusion has to exist here or it does not exist.
 *
 * WHY THIS RUNS BEFORE THE `status !== "APPROVED"` ALLOW
 *   The forgery's whole point is to CREATE an APPROVED receipt, so it happens while the on-disk
 *   receipt is still PENDING. A rule that only fires under an APPROVED receipt is a rule the attack
 *   never reaches. Everything else in this gate is correctly APPROVED-only — there is no
 *   implementation to separate before then — but the receipt surface is not.
 *
 * WHY THE LEGITIMATE REVIEWER'S WRITE IS AUTHORIZED *HERE*, NOT BY `reviewer-verdict-guard`
 *   `agents/plan-checker.md` step 5 tells the reviewer to Write exactly this path, and
 *   `reviewer-verdict-guard.ts` does hold that write to `proposed.reviewer_session_id === actor`.
 *   But the reviewer is a DISPATCHED SUBAGENT and that guard is wired in skill frontmatter, so it
 *   does not fire for the reviewer's own call at all — it only ever gated the dispatching
 *   conversation. The reviewer's finalization was therefore ungated in fact, which is also why the
 *   forgery worked. So the same identity check is made here, where the call is actually observed,
 *   and it is deliberately a duplicate rather than a delegation: two gates, one rule, neither
 *   assuming the other fires.
 *
 * WHAT THIS DOES NOT CLOSE, MEASURED AFTER THE FIX — AND IT IS SIMPLER THAN AN EARLIER VERSION OF
 * THIS NOTE ADMITTED. The whole PENDING window is open, and not by a clever route: a conversation-level
 * approver may `Write src/a.js` — plain content, canonical path, no Bash, no symlink, no `..` — and it
 * is ALLOWED, because `if (receipt.status !== "APPROVED") allow()` sits above every actor comparison.
 * Reproduced at `a80e920`, before any of the receipt work, and again with every rule in this file in
 * place. The Bash route below is a further consequence, not the exposure itself; framing it as the
 * exposure understates how directly reachable this is.
 *
 * The receipt SURFACE is the one thing that is closed during PENDING (that is what the block below is
 * for), so what remains open is arbitrary project mutation by the approver before review completes,
 * plus this: `Write .claude/probe.ts` (permitted orchestrator surface) then `Bash bun .claude/probe.ts`,
 * where the probe writes the receipt with raw `fs`, which no hook sees. Re-measured with this rule in
 * place: both calls ALLOWED, and `validateGeneratedPlanArtifact` then admitted the fabricated receipt.
 *
 * TWO NARROW CLOSURES WERE TRIED AND BOTH FAIL, so neither is implemented here:
 *   - Scoping the Bash denial to commands whose TEXT can reach `.planning/.state` (the shape
 *     `reviewer-verdict-guard` already runs) does not see it: the command is `bun .claude/probe.ts`
 *     and contains no such substring. Measured, not argued.
 *   - A PostToolUse re-validation against a hook-observed record needs that record, which is the
 *     round-9 nonce under another name — and the record itself would sit in `.planning/.state`,
 *     writable by the same raw `fs` call, so the check recurses onto its own premise.
 * The only closure found is denying the approver Bash across the whole PENDING phase, i.e. across
 * planning, which is a blanket denial and is deliberately NOT imposed. Reported instead.
 *
 * A hard link from a permitted `.planning` name onto the receipt is already refused structurally:
 * `safeProjectPath` rejects any leaf with a link count above one, so both names are unwritable.
 *
 * SCOPE IS COMPUTED FROM WHERE THE BYTES LAND, NOT FROM `projectRelativePath`.
 *   This block used `projectRelativePath` to ask "is this the receipt?". That function returns
 *   `null` for a path it REFUSES TO VOUCH FOR, and a `?.startsWith` over `null` reads the refusal as
 *   "not the receipt" and skips the block entirely. Measured with this binary: spelling the target
 *   `.planning/.state/../.state/review.json` — one `..`, which `safeProjectPath` rejects at its
 *   second line — skipped all nine conditions below and ALLOWED the round-9 forged receipt at three
 *   of four actor/status combinations (PENDING conversation-level approver, PENDING implementer
 *   subagent, APPROVED implementer subagent; the fourth denies only incidentally, via the
 *   permitted-directory check further down). `Write` accepts such a `file_path` and the bytes land at
 *   the resolved target. The polarity was inverted against this codebase's own convention:
 *   `orchestrator-mutation-guard` does `if (!relative) return false` on the identical sentinel.
 *
 *   `resolvedProjectRelativePath` answers only "where does this land, project-relative", so every
 *   spelling that reaches `.planning/.state` enters the block and is judged by the nine conditions —
 *   `safeExactTarget` among them, which is where the `..` spelling now dies. Scoping deliberately
 *   stops at the RESOLVED LOCATION and does not fold in the aliasing rejections: a hard link at
 *   `.planning/alias.ts` still resolves to `.planning/alias.ts`, stays out of this block, and keeps
 *   `aliasRejectionReason`'s self-diagnosing denial instead of being re-rendered as a receipt error.
 *
 * WHAT THIS DOES NOT BUY, STATED PLAINLY. Every ALLOW the `..` spelling produced was already
 * reachable by the raw-`fs` route documented above — during PENDING the actor's Bash is unrestricted,
 * and an implementer subagent's Bash is unrestricted at every status. So this closes a gate hole, not
 * an attack: it removes the case where the gate ITSELF signs off on a forged receipt.
 *
 * THE DENIAL IS ALSO THE IDENTITY DELIVERY CHANNEL. A subagent cannot read its own `agent_id`, and
 * the additionalContext channel in `reviewer-verdict-guard` does not reach it either (same
 * skill-scope reason). So every denial on this path names the actor identity verbatim: the reviewer
 * learns what to record by being refused once, exactly as `denySeparation` intends.
 */
if (FILE_TOOLS.has(tool)) {
  const target = tool === "NotebookEdit" ? input.notebook_path : input.file_path;
  const relative = resolvedProjectRelativePath(cwd, target);
  if (relative === RECEIPT_STATE_DIRECTORY || relative?.startsWith(`${RECEIPT_STATE_DIRECTORY}/`)) {
    const actor = hookActorIdentity(payload);
    const identity = actor === null ? "unavailable" : `"${actor}"`;
    const refuse = (detail: string): never => deny(
      `IMPLEMENTER IDENTITY GATE (${receipt.workflow}): ${detail}. \`${RECEIPT_STATE_DIRECTORY}/\` holds the ` +
      `receipt that every other gate reads its authority from, so it is not part of any orchestrator's write ` +
      `surface: the only write permitted here is the dispatched reviewer's one finalization of ` +
      `\`${RECEIPT_RELATIVE}\`, preserving every approval-owned field. This actor's identity is ${identity}; ` +
      `a reviewer must record it verbatim as reviewer_session_id.`,
    );
    if (tool !== "Write") refuse(`a ${tool} of the review receipt state cannot be a review finalization`);
    if (relative !== RECEIPT_RELATIVE) refuse(`\`${relative}\` is not the review receipt`);
    if (typeof target !== "string" || !safeExactTarget(cwd, target, join(cwd, ".planning", ".state", "review.json"))) refuse("this target is not the canonical receipt path");
    if (receipt.status !== "PENDING") refuse(`the receipt is already ${receipt.status} and is not open for finalization`);
    if (actor === null) refuse("this write carries no usable actor identity, so no reviewer can be named by it");
    // Finalization is the dispatched reviewer's call. A conversation-level actor writing the
    // receipt is the orchestrator finalizing its own review, which is the forgery, not the flow.
    if (!isSubagentPayload(payload)) refuse("only a dispatched reviewer subagent may finalize the receipt, and this call is conversation-level");
    if (actor === receipt.approved_session_id) refuse("this actor approved the plan and may not also review it");
    const proposed = parseReviewState(String(input.content ?? ""), receipt.workflow);
    if ("code" in proposed) refuse(`the proposed receipt is invalid (${proposed.code}): ${proposed.message}`);
    if (proposed.status === "PENDING") refuse("a finalization must set a final status");
    if (proposed.reviewer_session_id !== actor) refuse("reviewer_session_id must be exactly the writing actor's identity");
    // `proposed.workflow !== receipt.workflow` is UNREACHABLE as written, and deliberately kept:
    // `parseReviewState` above is given `receipt.workflow` as the expected value, so a differing
    // workflow is already a schema failure. It stays as the guard for the day that argument is
    // dropped; `tests/implementer-identity-contract.test.mjs` pins the schema denial that makes it
    // unreachable, so the change that would make this line live cannot pass unnoticed. Every OTHER
    // field here is reachable and has its own mutation test.
    if (proposed.workflow !== receipt.workflow || proposed.plan_file !== receipt.plan_file || proposed.plan_hash !== receipt.plan_hash
      || proposed.approved_session_id !== receipt.approved_session_id || proposed.approved_at !== receipt.approved_at) {
      refuse("a finalization must reproduce workflow, plan_file, plan_hash, approved_session_id, and approved_at unchanged");
    }
    allow();
  }
}

// Before APPROVED there is no implementation to gate. The receipt surface itself is already
// decided above, because that one is not an implementation question and does not wait for APPROVED.
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
    orchestratorSurfaceOrDeny(
      `IMPLEMENTER IDENTITY GATE (${receipt.workflow})`,
      builtInOrchestratorDirectories(receipt.workflow),
      `this conversation ${isApprover ? "approved" : "reviewed"} ${receipt.plan_file} and may not also implement it.`,
    );
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
