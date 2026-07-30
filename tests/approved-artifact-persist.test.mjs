import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "approved-artifact-persist.ts");

function run(payload, cwd, workflow = "ds") {
  return spawnSync("bun", [HOOK, "--workflow", workflow], { cwd, input: JSON.stringify(payload), encoding: "utf8" });
}

function withProject(test) {
  const cwd = mkdtempSync(join(tmpdir(), "native-plan-"));
  try { test(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

withProject((cwd) => {
  const plan = "# Implementation\n\n- Preserve trailing spaces  \n- And final newline\n";
  mkdirSync(join(cwd, ".planning"));
  writeFileSync(join(cwd, ".planning", "PLAN.md"), "obsolete plan\n");
  writeFileSync(join(cwd, ".planning", "PLAN_REVIEWED.md"), "obsolete review\n");
  const result = run({ tool_name: "ExitPlanMode", session_id: "session-123", tool_input: { plan } }, cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), plan, "PLAN.md must be byte-for-byte tool_input.plan");
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".planning", "PLAN.meta.json"), "utf8")), {
    schemaVersion: 1,
    workflow: "ds",
    planHash: createHash("sha256").update(plan).digest("hex"),
    approvedSession: "session-123",
    approvedAt: JSON.parse(readFileSync(join(cwd, ".planning", "PLAN.meta.json"), "utf8")).approvedAt,
  });
  assert.match(JSON.parse(readFileSync(join(cwd, ".planning", "PLAN.meta.json"), "utf8")).approvedAt, /^\d{4}-\d{2}-\d{2}T[^\n]+Z$/);
  assert.ok(!existsSync(join(cwd, ".planning", "PLAN_REVIEWED.md")), "replacement plan must stale prior review");
});

withProject((cwd) => {
  const result = run({ tool_name: "ExitPlanMode", tool_input: {}, session_id: "session-456" }, cwd);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing string plan/);
  assert.ok(!existsSync(join(cwd, ".planning")));
});

// Claude Code's current PostToolUse event for ExitPlanMode omits the plan from
// tool_input. The approved plan remains in the matching tool-use record in its
// transcript, whose path is included in the hook payload.
withProject((cwd) => {
  const plan = "# Approved from transcript\n\n- Preserve this exact plan\n";
  const transcript = join(cwd, "transcript.jsonl");
  writeFileSync(transcript, `${JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-approved-plan", name: "ExitPlanMode", input: { plan } }] } })}\n`);
  const result = run({
    tool_name: "ExitPlanMode",
    tool_use_id: "toolu-approved-plan",
    tool_input: {},
    session_id: "session-456",
    transcript_path: transcript,
  }, cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), plan);
});

// Transcript recovery must select the first complete, exact ExitPlanMode tool use,
// ignoring records for other IDs or tools and later duplicate records.
withProject((cwd) => {
  const firstPlan = "# First exact approved plan\n";
  const laterPlan = "# Later duplicate must not override\n";
  const transcript = join(cwd, "decoys-and-duplicate.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-other", name: "ExitPlanMode", input: { plan: "# Wrong ID\n" } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "Read", input: { plan: "# Wrong tool\n" } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: firstPlan } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: laterPlan } }] } }),
  ].join("\n"));
  const result = run({
    tool_name: "ExitPlanMode", tool_use_id: "toolu-exact", tool_input: {},
    session_id: "first-exact", transcript_path: transcript,
  }, cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), firstPlan);
});

// An unrelated partial JSONL write must not invalidate an earlier or later exact match.
withProject((cwd) => {
  const plan = "# Exact plan despite corrupt unrelated record\n";
  const transcript = join(cwd, "malformed-unrelated.jsonl");
  writeFileSync(transcript, [
    '{"message":{"content":[',
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan } }] } }),
  ].join("\n"));
  const result = run({
    tool_name: "ExitPlanMode", tool_use_id: "toolu-exact", tool_input: {},
    session_id: "corruption-recovery", transcript_path: transcript,
  }, cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), plan);
});

// A transcript with no exact valid plan remains fail-closed and creates no artifact.
withProject((cwd) => {
  const transcript = join(cwd, "no-exact-match.jsonl");
  writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "Read", input: { plan: "# Wrong tool\n" } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: {} }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-other", name: "ExitPlanMode", input: { plan: "# Wrong ID\n" } }] } }),
  ].join("\n"));
  const result = run({
    tool_name: "ExitPlanMode", tool_use_id: "toolu-exact", tool_input: {},
    session_id: "no-match", transcript_path: transcript,
  }, cwd);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing string plan/);
  assert.ok(!existsSync(join(cwd, ".planning")));
});

withProject((cwd) => {
  const result = run({ tool_name: "ExitPlanMode", tool_input: { plan: "# valid" } }, cwd);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /nonempty session_id/);
  assert.ok(!existsSync(join(cwd, ".planning")));
});

withProject((cwd) => {
  const result = run({ tool_name: "Read", tool_input: {} }, cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(cwd, ".planning")));
});

for (const workflow of ["writing", "workshop", "workflow-creator"]) {
  withProject((cwd) => {
    const plan = `# ${workflow} plan\n`;
    const result = run({ tool_name: "ExitPlanMode", session_id: `${workflow}-approval`, tool_input: { plan } }, cwd, workflow);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), plan);
    const metadata = JSON.parse(readFileSync(join(cwd, ".planning", "PLAN.meta.json"), "utf8"));
    assert.equal(metadata.approvedSession, `${workflow}-approval`);
    assert.equal(metadata.workflow, workflow);
  });
}

withProject((cwd) => {
  const result = run({ tool_name: "ExitPlanMode", session_id: "dev", tool_input: { plan: "# dev" } }, cwd, "dev");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /native-plan workflow/);
});

console.log("approved-artifact-persist tests passed");
