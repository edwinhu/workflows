/**
 * A reviewer that DISPATCHES its own implementer is not separated from it, however different their
 * agent_ids are. This suite pins both halves of that check: the one case it proves, and the much
 * larger set of cases where it must FAIL OPEN rather than deny ordinary work.
 *
 * The layout it reads — `<transcript dir>/<session>/subagents/agent-<id>.{jsonl,meta.json}` — is
 * Claude Code internals, not a public interface. These fixtures are the record of what it looked
 * like when the check was written; if Claude Code changes it, every case here degrades to ALLOW,
 * which is exactly the intended failure mode.
 *
 * Run: bun test tests/lineage-contract.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const GATE = join(REPO, "hooks", "implementer-identity-gate.ts");

const planFile = "jazzy-leaping-scroll.md";
const plan = "# Exact generated plan\n";
const hash = createHash("sha256").update(plan).digest("hex");
const SESSION = "1b9ad423-73b6-4221-b60e-7ccf7858a169";
const REVIEWER_AGENT = "a850df8db797eebd9";
const IMPLEMENTER_AGENT = "b91ef00dcafe12345";
const TOOL_USE = "toolu_01C23ipzjvg2H8kDGarX54v1";

const root = mkdtempSync(join(tmpdir(), "lineage-"));
const project = join(root, "project");
const transcripts = join(root, "transcripts");
const subagents = join(transcripts, SESSION, "subagents");

function setup({ toolUseId = TOOL_USE, reviewerTranscript = `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"${TOOL_USE}","name":"Agent"}]}}\n`, meta } = {}) {
  rmSync(subagents, { recursive: true, force: true });
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(transcripts, `${SESSION}.jsonl`), "{}\n");
  writeFileSync(join(subagents, `agent-${IMPLEMENTER_AGENT}.meta.json`), meta ?? JSON.stringify({ agentType: "workflows:dev-implementer", description: "implement", ...(toolUseId === null ? {} : { toolUseId }), spawnDepth: 2 }));
  if (reviewerTranscript !== null) writeFileSync(join(subagents, `agent-${REVIEWER_AGENT}.jsonl`), reviewerTranscript);
}

function run() {
  const stdin = {
    session_id: SESSION,
    agent_id: IMPLEMENTER_AGENT,
    agent_type: "workflows:dev-implementer",
    transcript_path: join(transcripts, `${SESSION}.jsonl`),
    cwd: project,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: join(project, "src", "a.ts"), content: "export const a = 1;\n" },
    tool_use_id: "toolu_9",
  };
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CODE_ENTRYPOINT: "cli" };
  delete env.CLAUDE_SESSION_ID;
  return spawnSync("bun", [GATE], { cwd: project, env, input: JSON.stringify(stdin), encoding: "utf8" });
}

const denied = result => /"permissionDecision": "deny"/.test(result.stdout);

try {
  mkdirSync(join(project, ".planning", ".state"), { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, ".planning", planFile), plan);
  writeFileSync(join(project, ".planning", ".state", "review.json"), JSON.stringify({
    workflow: "dev", plan_file: planFile, plan_hash: hash,
    approved_session_id: SESSION, approved_at: "2026-01-01T00:00:00.000Z",
    status: "APPROVED", reviewer_session_id: `${SESSION}#${REVIEWER_AGENT}`, reviewed_at: "2026-01-01T00:01:00.000Z",
  }, null, 2));

  // THE GAP THIS CLOSES: distinct agent_ids, but the reviewer issued the dispatch.
  setup();
  const caught = run();
  assert.equal(caught.status, 0, caught.stderr);
  assert.ok(denied(caught), `reviewer-dispatched implementer must be denied: ${caught.stdout}`);
  assert.match(caught.stdout, /dispatched this implementer/);

  // ---------------------------------------------------------------------------------------------
  // FAIL OPEN. Each of these is a real shape seen on disk; denying any of them denies normal work.
  // ---------------------------------------------------------------------------------------------

  // `toolUseId` absent — 41% of real meta files on the machine this was measured on.
  setup({ toolUseId: null });
  assert.ok(!denied(run()), "meta without toolUseId must allow");

  // The dispatch came from somewhere other than the reviewer.
  setup({ reviewerTranscript: '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_other","name":"Agent"}]}}\n' });
  assert.ok(!denied(run()), "a dispatch the reviewer did not issue must allow");

  // The reviewer has no transcript at all.
  setup({ reviewerTranscript: null });
  assert.ok(!denied(run()), "a missing reviewer transcript must allow");

  // COINCIDENTAL TEXT MUST NOT DENY. A tool-use id is opaque and also turns up in ordinary content —
  // pasted logs, error text, quoted payloads. The substring search this check used to do turned any
  // such occurrence into a denial of legitimate work, which is the opposite of its fail-open design.
  for (const transcript of [
    `{"type":"user","message":{"content":[{"type":"text","text":"the log mentions ${TOOL_USE} in passing"}]}}\n`,
    `{"type":"assistant","message":{"content":[{"type":"text","text":"${TOOL_USE}"}]}}\n`,
    `{"type":"assistant","message":{"content":[{"type":"tool_result","tool_use_id":"${TOOL_USE}"}]}}\n`,
    `not json at all but it names ${TOOL_USE}\n`,
  ]) {
    setup({ reviewerTranscript: transcript });
    assert.ok(!denied(run()), `coincidental mention of the id must allow: ${transcript.trim()}`);
  }

  // A tool_use id that merely CONTAINS the target as a prefix is a different dispatch.
  setup({ reviewerTranscript: `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"${TOOL_USE}_extra","name":"Agent"}]}}\n` });
  assert.ok(!denied(run()), "an id with the target as a prefix must allow");

  // Malformed meta.
  setup({ meta: "{not json" });
  assert.ok(!denied(run()), "unparseable meta must allow");
  setup({ meta: "[1,2,3]" });
  assert.ok(!denied(run()), "non-object meta must allow");

  // The whole layout is gone — the case that matters if Claude Code changes its internals.
  rmSync(join(transcripts, SESSION), { recursive: true, force: true });
  assert.ok(!denied(run()), "an absent subagents layout must allow");

  // Rebuilding the layout re-arms the check: absence is not a latch.
  setup();
  assert.ok(denied(run()), "restoring the layout restores the denial");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("lineage-contract tests passed");
