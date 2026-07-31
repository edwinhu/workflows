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

// Claude Code 2.1.220 sends ExitPlanMode PostToolUse input as {}. The matching
// transcript tool-result points to the approved plan file via toolUseResult.filePath.
withProject((cwd) => {
  const plan = "# Approved from native result\n\n- Preserve trailing spaces  \n- And final newline\n";
  const approvedPlan = join(cwd, "approved-plan.md");
  const transcript = join(cwd, "transcript.jsonl");
  writeFileSync(approvedPlan, plan);
  writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-approved-plan", name: "ExitPlanMode", input: {} }] } }),
    JSON.stringify({
      message: { content: [{ type: "tool_result", tool_use_id: "toolu-approved-plan", content: "approved" }] },
      toolUseResult: { filePath: approvedPlan },
    }),
  ].join("\n"));
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

// Recovery is bound to the exact tool_use_id; decoy and later result files must
// never be selected by recency or filename heuristics.
withProject((cwd) => {
  const exactPlan = "# Exact matching result\n";
  const decoyPlan = "# Newest decoy must not win\n";
  const exactPath = join(cwd, "exact.md");
  const decoyPath = join(cwd, "decoy.md");
  const transcript = join(cwd, "decoys.jsonl");
  writeFileSync(exactPath, exactPlan);
  writeFileSync(decoyPath, decoyPlan);
  writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact", content: "approved" }] }, toolUseResult: { filePath: exactPath } }),
    JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-other", content: "approved" }] }, toolUseResult: { filePath: decoyPath } }),
  ].join("\n"));
  const result = run({
    tool_name: "ExitPlanMode", tool_use_id: "toolu-exact", tool_input: {},
    session_id: "exact-result", transcript_path: transcript,
  }, cwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), exactPlan);
});

for (const [name, prepare, expected] of [
  ["no matching tool result", (cwd, transcript) => writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-other" }] }, toolUseResult: { filePath: join(cwd, "other.md") } })), /matching transcript tool-result/],
  ["missing filePath", (_cwd, transcript) => writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: {} })), /absolute regular nonempty file/],
  ["relative filePath", (_cwd, transcript) => writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: "relative.md" } })), /absolute regular nonempty file/],
  ["directory filePath", (cwd, transcript) => writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: cwd } })), /absolute regular nonempty file/],
  ["empty file", (cwd, transcript) => { const path = join(cwd, "empty.md"); writeFileSync(path, ""); writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: path } })); }],
  ["invalid UTF-8", (cwd, transcript) => { const path = join(cwd, "invalid.md"); writeFileSync(path, Buffer.from([0xff])); writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: path } })); }, /exact valid UTF-8 bytes/],
]) {
  withProject((cwd) => {
    const transcript = join(cwd, `${name}.jsonl`);
    prepare(cwd, transcript);
    const result = run({
      tool_name: "ExitPlanMode", tool_use_id: "toolu-exact", tool_input: {},
      session_id: name, transcript_path: transcript,
    }, cwd);

    assert.equal(result.status, 2, `${name}: ${result.stderr}`);
    assert.match(result.stderr, expected ?? /absolute regular nonempty file/);
    assert.ok(!existsSync(join(cwd, ".planning")));
  });
}

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
