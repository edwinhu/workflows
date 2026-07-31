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

function runGate(payload, cwd, workflow = "writing", session = "implementation-session") {
  return spawnSync("bun", [join(REPO, "hooks", "approved-artifact-gate.ts"), "--workflow", workflow], {
    cwd,
    env: { ...process.env, CLAUDE_SESSION_ID: session },
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
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

// Claude Code's observed native ExitPlanMode transcript stores the approved plan in
// the matching tool_use input. Persist it, add an independent review verdict, then
// ensure the writing workflow allows its review step after that independent approval.
withProject(function writingToolUseTranscriptPersistsAndAllowsWritingReviewAfterIndependentApproval(cwd) {
  const plan = "# Writing plan from tool use\n";
  const toolUseId = "toolu-writing-native-plan";
  const transcript = join(cwd, "writing-transcript.jsonl");
  writeFileSync(transcript, JSON.stringify({
    message: { content: [{ type: "tool_use", id: toolUseId, name: "ExitPlanMode", input: { plan } }] },
  }));
  const persisted = run({
    tool_name: "ExitPlanMode", tool_use_id: toolUseId, tool_input: {},
    session_id: "writing-approval", transcript_path: transcript,
  }, cwd, "writing");
  assert.equal(persisted.status, 0, persisted.stderr);
  const hash = createHash("sha256").update(plan).digest("hex");
  writeFileSync(join(cwd, ".planning", "PLAN_REVIEWED.md"), `---\nplan_hash: ${hash}\nstatus: APPROVED\nreviewer_session_id: writing-reviewer\nreviewed_at: 2030-01-01T00:00:00.000Z\n---\n\nreview\n`);
  const gate = runGate({
    tool_name: "Workflow", cwd, tool_input: { name: "workflows:writing-review", args: { projectDir: cwd } },
  }, cwd);
  assert.equal(gate.status, 0, gate.stderr);
  assert.equal(gate.stdout, "", gate.stdout);
});

// Transcript recovery must scan every exact-ID record, reject ambiguous sources, and
// ignore malformed or non-matching records rather than choosing the first match.
for (const [name, prepare, expectedPlan] of [
  ["malformed unrelated JSONL", (cwd, transcript) => {
    const plan = "# Exact plan after malformed JSONL\n";
    writeFileSync(transcript, [
      "{ malformed unrelated record",
      JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan } }] } }),
    ].join("\n"));
    return plan;
  }, "# Exact plan after malformed JSONL\n"],
  ["wrong tool name", (_cwd, transcript) => writeFileSync(transcript, JSON.stringify({
    message: { content: [{ type: "tool_use", id: "toolu-exact", name: "Write", input: { plan: "# Decoy\n" } }] },
  })), undefined],
  ["wrong tool ID", (_cwd, transcript) => writeFileSync(transcript, JSON.stringify({
    message: { content: [{ type: "tool_use", id: "toolu-other", name: "ExitPlanMode", input: { plan: "# Decoy\n" } }] },
  })), undefined],
  ["non-string tool-use plan", (_cwd, transcript) => writeFileSync(transcript, JSON.stringify({
    message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: { text: "# Not a string\n" } } }] },
  })), undefined],
  ["matching tool-use and result plans", (cwd, transcript) => {
    const plan = "# Matching plan\n";
    const resultPath = join(cwd, "matching-result-plan.md");
    writeFileSync(resultPath, plan);
    writeFileSync(transcript, [
      JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan } }] } }),
      JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: resultPath } }),
    ].join("\n"));
    return plan;
  }, "# Matching plan\n"],
  ["conflicting tool-use and result plans", (cwd, transcript) => {
    const resultPath = join(cwd, "result-plan.md");
    writeFileSync(resultPath, "# Result plan\n");
    writeFileSync(transcript, [
      JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: "# Tool-use plan\n" } }] } }),
      JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: resultPath } }),
    ].join("\n"));
  }, undefined],
  ["malformed and valid matching tool-use records", (_cwd, transcript) => writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: {} }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: "# Valid but ambiguous\n" } }] } }),
  ].join("\n")), undefined],
  ["duplicate matching tool-use records", (_cwd, transcript) => writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: "# First\n" } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: "# Second\n" } }] } }),
  ].join("\n")), undefined],
  ["duplicate matching tool-result records", (cwd, transcript) => {
    const resultPath = join(cwd, "result-plan.md");
    writeFileSync(resultPath, "# Result plan\n");
    writeFileSync(transcript, [
      JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: resultPath } }),
      JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: resultPath } }),
    ].join("\n"));
  }, undefined],
  ["invalid matching result path with valid tool-use", (_cwd, transcript) => writeFileSync(transcript, [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "toolu-exact", name: "ExitPlanMode", input: { plan: "# Tool-use plan\n" } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "toolu-exact" }] }, toolUseResult: { filePath: "relative.md" } }),
  ].join("\n")), undefined],
]) {
  withProject((cwd) => {
    const transcript = join(cwd, `${name}.jsonl`);
    prepare(cwd, transcript);
    const result = run({
      tool_name: "ExitPlanMode", tool_use_id: "toolu-exact", tool_input: {},
      session_id: name, transcript_path: transcript,
    }, cwd);

    if (expectedPlan) {
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      assert.equal(readFileSync(join(cwd, ".planning", "PLAN.md"), "utf8"), expectedPlan);
    } else {
      assert.equal(result.status, 2, `${name}: ${result.stderr}`);
      assert.ok(!existsSync(join(cwd, ".planning")), `${name}: must not create artifacts`);
    }
  });
}

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
