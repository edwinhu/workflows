/**
 * Reviewer identity is keyed to the hook stdin PAYLOAD, never to process.env.
 *
 * Claude Code never sets CLAUDE_SESSION_ID. A real PreToolUse hook process env carries
 * CLAUDE_CODE_SESSION_ID / CLAUDE_CODE_CHILD_SESSION / CLAUDE_PROJECT_DIR and no
 * CLAUDE_SESSION_ID key at all, so every reviewer receipt finalization denied
 * unconditionally and @plan-reviewer stalled with no verdict. Renaming the variable does
 * not help either: CLAUDE_CODE_SESSION_ID is session-TREE-wide and is byte-identical in a
 * parent conversation and its Agent()-dispatched subagent, so reviewer != approver could
 * never hold. The only usable identity is the payload's session_id plus agent_id.
 *
 * These cases run the hooks with NO CLAUDE_SESSION_ID in the environment — production's
 * actual condition.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const GUARD = join(REPO, "hooks", "reviewer-verdict-guard.ts");
const GATE = join(REPO, "hooks", "approved-artifact-gate.ts");

const planFile = "jazzy-leaping-scroll.md";
const plan = "# Exact generated plan\n";
const hash = createHash("sha256").update(plan).digest("hex");

const APPROVAL_SESSION = "sess-tree-abc";
const REVIEWER_AGENT = "a850df8db797eebd9";
const IMPLEMENTER_AGENT = "b91ef00dcafe12345";
const REVIEWER_ACTOR = `${APPROVAL_SESSION}#${REVIEWER_AGENT}`;

const pending = {
  workflow: "dev",
  plan_file: planFile,
  plan_hash: hash,
  approved_session_id: APPROVAL_SESSION,
  approved_at: "2026-01-01T00:00:00.000Z",
  status: "PENDING",
  reviewer_session_id: "",
  reviewed_at: "",
};
function final(overrides = {}) {
  return JSON.stringify({ ...pending, status: "APPROVED", reviewer_session_id: REVIEWER_ACTOR, reviewed_at: "2026-01-01T00:01:00.000Z", ...overrides }, null, 2);
}

/** Environment as Claude Code actually provides it: CLAUDE_SESSION_ID is absent. */
function productionEnv() {
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: APPROVAL_SESSION, CLAUDE_CODE_ENTRYPOINT: "cli" };
  delete env.CLAUDE_SESSION_ID;
  return env;
}

/**
 * ABSENCE OF AN IDENTITY MUST BE EXPRESSED BY KEY PRESENCE, NEVER BY A DEFAULT PARAMETER.
 *
 * JS applies a destructuring default to an EXPLICITLY passed `undefined`, so
 * `runGuard(cwd, { agentId: undefined })` — written to mean "a parent conversation, which carries no
 * agent_id" — re-applied `agentId = REVIEWER_AGENT` and sent the reviewer's own agent id. The
 * "parent-triggered write is the approving actor" case below therefore never exercised a
 * conversation-level payload at all: it passed on the unrelated `reviewer_session_id` mismatch it
 * also happened to set, and would have kept passing had the parent case been completely broken.
 *
 * `Object.hasOwn` is the fix for the whole class: the KEY decides, and `undefined` is a legitimate
 * value meaning "omit this field from the payload".
 */
function optional(options, key, fallback) {
  return Object.hasOwn(options, key) ? options[key] : fallback;
}

function runGuard(cwd, options = {}) {
  const { workflow = "dev", tool = "Write", filePath = ".planning/.state/review.json", content = final(), command = "" } = options;
  const sessionId = optional(options, "sessionId", APPROVAL_SESSION);
  const agentId = optional(options, "agentId", REVIEWER_AGENT);
  const toolInput = tool === "Bash" ? { command } : { file_path: filePath, content };
  const stdin = { session_id: sessionId, transcript_path: join(cwd, "transcript.jsonl"), cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1" };
  if (agentId !== undefined) { stdin.agent_id = agentId; stdin.agent_type = "general-purpose"; }
  return spawnSync("bun", [GUARD, "--workflow", workflow], { cwd, env: productionEnv(), input: JSON.stringify(stdin), encoding: "utf8" });
}

function runGate(cwd, options = {}) {
  const { workflow = "dev" } = options;
  const sessionId = optional(options, "sessionId", APPROVAL_SESSION);
  const agentId = optional(options, "agentId", IMPLEMENTER_AGENT);
  const stdin = { session_id: sessionId, transcript_path: join(cwd, "transcript.jsonl"), cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "workflows:dev-implementer" }, tool_use_id: "toolu_2" };
  if (agentId !== undefined) { stdin.agent_id = agentId; stdin.agent_type = "workflows:dev-implementer"; }
  return spawnSync("bun", [GATE, "--workflow", workflow], { cwd, env: productionEnv(), input: JSON.stringify(stdin), encoding: "utf8" });
}

function allowed(result, message) {
  assert.equal(result.status, 0, `${message}: exit ${result.status} ${result.stderr}`);
  assert.doesNotMatch(result.stdout, /"permissionDecision": "deny"/, `${message}: ${result.stdout}`);
}
function denied(result, message, pattern) {
  assert.equal(result.status, 0, `${message}: exit ${result.status} ${result.stderr}`);
  assert.match(result.stdout, /"permissionDecision": "deny"/, `${message}: ${result.stdout}`);
  if (pattern) assert.match(result.stdout, pattern, `${message}: ${result.stdout}`);
}

const cwd = mkdtempSync(join(tmpdir(), "reviewer-identity-"));
try {
  const planning = join(cwd, ".planning");
  mkdirSync(join(planning, ".state"), { recursive: true });
  writeFileSync(join(planning, planFile), plan);
  const writePending = () => writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(pending));
  writePending();

  // (i) PRODUCTION'S ACTUAL CONDITION: no CLAUDE_SESSION_ID anywhere. A reviewer subagent
  // dispatched from the approving conversation must be able to finalize the receipt.
  allowed(runGuard(cwd), "reviewer subagent finalizes receipt with no CLAUDE_SESSION_ID in env");

  // (iii) Parent-triggered vs subagent-triggered payloads are DIFFERENT actors even though
  // session_id is byte-identical. The parent is the approver and must be refused.
  //
  // The content here is the SAME receipt the reviewer subagent just finalized successfully, so the
  // only thing that can produce a denial is the actor: had this been written with a receipt that was
  // independently invalid, the case would pass whether or not the parent was distinguished at all.
  denied(runGuard(cwd, { agentId: undefined }), "parent-triggered write is the approving actor", /session/i);
  // ...and the helper must really be omitting the key, not defaulting it back to the reviewer's id.
  denied(
    runGuard(cwd, { agentId: undefined, content: final({ reviewer_session_id: APPROVAL_SESSION }) }),
    "parent-triggered write naming itself as reviewer",
    /session/i,
  );

  // (ii) Same-session collision: the receipt may never name the approver as its reviewer,
  // and the cause must be reported as session separation, not as a generic field error.
  denied(
    runGuard(cwd, { content: final({ reviewer_session_id: APPROVAL_SESSION }) }),
    "reviewer_session_id equal to approved_session_id",
    /session separation/i,
  );

  // A subagent cannot forge another actor's identity.
  denied(runGuard(cwd, { content: final({ reviewer_session_id: `${APPROVAL_SESSION}#deadbeef` }) }), "forged agent identity", /session separation/i);
  denied(runGuard(cwd, { content: final({ reviewer_session_id: "reviewer-456" }) }), "arbitrary reviewer identity", /session separation/i);

  // A payload with no session_id at all cannot establish any identity.
  denied(runGuard(cwd, { sessionId: "" }), "empty payload session_id");

  // Non-identity schema failures must still deny, and must NOT claim session separation.
  const hashMismatch = runGuard(cwd, { content: final({ plan_hash: "a".repeat(64) }) });
  denied(hashMismatch, "plan hash immutable");
  assert.doesNotMatch(hashMismatch.stdout, /session separation/i, "hash mismatch must not be reported as session separation");

  // The reviewer learns its own actor identity from the guard: the mandatory pre-finalization
  // hash call carries it as PreToolUse additionalContext. Without a delivery channel the
  // subagent cannot know its agent_id and the contract is unsatisfiable.
  const hashCall = runGuard(cwd, { tool: "Bash", command: `sha256sum .planning/${planFile}` });
  allowed(hashCall, "reviewer may hash the receipt-selected plan");
  assert.match(hashCall.stdout, new RegExp(REVIEWER_ACTOR), `hash call must disclose the reviewer actor identity: ${hashCall.stdout}`);

  // Implementation gate: keyed to the payload actor, not the env.
  writeFileSync(join(planning, ".state", "review.json"), final());
  allowed(runGate(cwd), "implementer subagent admitted against an APPROVED receipt");
  denied(runGate(cwd, { agentId: REVIEWER_AGENT }), "reviewer may not also implement", /review and implementation actors must differ/i);
  denied(runGate(cwd, { sessionId: "" }), "gate rejects an identity-less payload");
  writePending();
  denied(runGate(cwd), "PENDING receipt admits no implementation");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log("reviewer-identity-contract tests passed");
