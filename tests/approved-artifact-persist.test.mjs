import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "approved-artifact-persist.ts");

function run(payload, cwd) {
  return spawnSync("bun", [HOOK, "--workflow", "ds"], { cwd, input: JSON.stringify(payload), encoding: "utf8" });
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

console.log("approved-artifact-persist tests passed");
