import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "approved-artifact-persist.ts");
function run(payload, cwd, workflow = "ds") { return spawnSync("bun", [HOOK, "--workflow", workflow], { cwd, input: JSON.stringify(payload), encoding: "utf8" }); }
function withProject(test) { const cwd = mkdtempSync(join(tmpdir(), "native-plan-")); try { test(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); } }
function payload(cwd, planFile, session = "approval-session", id = "toolu-plan") {
  const transcript = join(cwd, `${id}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: id, content: "approved" }] }, toolUseResult: { filePath: planFile } }));
  return { tool_name: "ExitPlanMode", tool_use_id: id, tool_input: {}, session_id: session, transcript_path: transcript };
}

withProject((cwd) => {
  const planning = join(cwd, ".planning"); mkdirSync(join(planning, ".state"), { recursive: true });
  const planPath = join(planning, "peaceful-generated.md"); const plan = "# Exact native plan\n"; writeFileSync(planPath, plan);
  writeFileSync(join(planning, "PLAN.md"), "superseded copy\n");
  writeFileSync(join(planning, ".state", "plan.json"), "obsolete\n");
  const result = run(payload(cwd, planPath), cwd);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(readFileSync(join(planning, ".state", "review.json"), "utf8"));
  assert.deepEqual(receipt, {
    workflow: "ds", plan_file: "peaceful-generated.md", plan_hash: createHash("sha256").update(plan).digest("hex"),
    approved_session_id: "approval-session", approved_at: receipt.approved_at,
    status: "PENDING", reviewer_session_id: "", reviewed_at: "",
  });
  assert.match(receipt.approved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(readFileSync(planPath, "utf8"), plan);
  assert.equal(readFileSync(join(planning, "PLAN.md"), "utf8"), "superseded copy\n");
  assert.equal(existsSync(join(planning, ".state", "plan.json")), false);
});

withProject((cwd) => {
  const planning = join(cwd, ".planning"); mkdirSync(join(planning, ".state"), { recursive: true });
  const first = join(planning, "first.md"); const second = join(planning, "second.md"); writeFileSync(first, "# first\n"); writeFileSync(second, "# second\n");
  assert.equal(run(payload(cwd, first, "approval-one", "toolu-one"), cwd).status, 0);
  const prior = JSON.parse(readFileSync(join(planning, ".state", "review.json"), "utf8")); prior.status = "APPROVED"; prior.reviewer_session_id = "review-one"; prior.reviewed_at = "2099-01-01T00:00:00.000Z"; writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(prior));
  assert.equal(run(payload(cwd, second, "approval-two", "toolu-two"), cwd).status, 0);
  const next = JSON.parse(readFileSync(join(planning, ".state", "review.json"), "utf8"));
  assert.equal(next.plan_file, "second.md"); assert.equal(next.status, "PENDING"); assert.equal(next.approved_session_id, "approval-two");
});

for (const [name, setup, pattern] of [
  ["raw plan only", cwd => ({ tool_name: "ExitPlanMode", tool_input: { plan: "# raw" }, session_id: "s" }), /transcript lookup identity/],
  ["outside plan", cwd => { const path = join(cwd, "outside.md"); writeFileSync(path, "# outside\n"); return payload(cwd, path); }, /direct child/],
  ["reserved PLAN", cwd => { mkdirSync(join(cwd, ".planning")); const path = join(cwd, ".planning", "PLAN.md"); writeFileSync(path, "# fixed\n"); return payload(cwd, path); }, /direct child/],
  ["missing result", cwd => { const transcript = join(cwd, "missing.jsonl"); writeFileSync(transcript, "{}"); return { tool_name: "ExitPlanMode", tool_use_id: "missing", tool_input: {}, session_id: "s", transcript_path: transcript }; }, /matching transcript/],
]) withProject((cwd) => { const result = run(setup(cwd), cwd); assert.equal(result.status, 2, `${name}: ${result.stderr}`); assert.match(result.stderr, pattern); });

withProject((cwd) => {
  mkdirSync(join(cwd, ".planning")); const outside = mkdtempSync(join(tmpdir(), "state-outside-"));
  try { symlinkSync(outside, join(cwd, ".planning", ".state")); const path = join(cwd, ".planning", "safe.md"); writeFileSync(path, "# safe\n"); const result = run(payload(cwd, path), cwd); assert.equal(result.status, 2); assert.match(result.stderr, /real directory/); }
  finally { rmSync(outside, { recursive: true, force: true }); }
});

for (const workflow of ["work", "writing", "workshop", "workflow-creator"]) withProject((cwd) => {
  mkdirSync(join(cwd, ".planning")); const path = join(cwd, ".planning", `${workflow}-generated.md`); writeFileSync(path, `# ${workflow}\n`);
  const result = run(payload(cwd, path, `${workflow}-approval`), cwd, workflow); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".planning", ".state", "review.json"), "utf8")).workflow, workflow);
});

console.log("approved-artifact-persist tests passed");
