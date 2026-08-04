import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "approved-artifact-persist.ts");
function run(payload, cwd, workflow = "ds", workflowPolicy = "") { return spawnSync("bun", [HOOK, ...(workflowPolicy ? ["--workflow-policy", workflowPolicy] : ["--workflow", workflow])], { cwd, input: JSON.stringify(payload), encoding: "utf8" }); }
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

for (const [name, setup, pattern, expectedStatus = 2] of [
  ["raw plan only", cwd => ({ tool_name: "ExitPlanMode", tool_input: { plan: "# raw" }, session_id: "s" }), /transcript lookup identity/],
  ["outside plan", cwd => { const path = join(cwd, "outside.md"); writeFileSync(path, "# outside\n"); return payload(cwd, path); }, /direct child/, 1],
  ["reserved PLAN", cwd => { mkdirSync(join(cwd, ".planning")); const path = join(cwd, ".planning", "PLAN.md"); writeFileSync(path, "# fixed\n"); return payload(cwd, path); }, /direct child/, 1],
  // NEITHER SOURCE YIELDED A PATH — LOUD, NOT SILENT. This used to exit 1 on the theory that the
  // transcript record would show up on a retry. It does not: a retry is a new tool_use_id whose
  // record has not been appended either, so the miss is permanent. Exit 1 is invisible, and an
  // invisible permanent failure is precisely the "looks governed and is not" shape this hook exists
  // to prevent. Measured in rule611: two approvals, two silent deferrals, no receipt.
  ["no path from either source", cwd => { const transcript = join(cwd, "missing.jsonl"); writeFileSync(transcript, "{}"); return { tool_name: "ExitPlanMode", tool_use_id: "missing", tool_input: {}, session_id: "s", transcript_path: transcript }; }, /NO RECEIPT WAS WRITTEN/, 2],
]) withProject((cwd) => { const result = run(setup(cwd), cwd); assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`); assert.match(result.stderr, pattern); });

/**
 * THE REAL POSTTOOLUSE SHAPE — and the one every fixture above gets wrong.
 *
 * `payload()` writes a transcript that ALREADY contains this call's tool_result. That never happens
 * at PostToolUse time: Claude Code has not appended the record yet when the hook runs. So the whole
 * suite above was exercising a fallback that, in production, never had anything to find — green
 * throughout, while no receipt had ever bound on a real machine.
 *
 * These two cases use the payload Claude Code actually sends: `tool_response.filePath` present, and
 * a transcript with NO matching record. Verified to fail against the pre-fix hook.
 */
withProject((cwd) => {
  const planning = join(cwd, ".planning"); mkdirSync(join(planning, ".state"), { recursive: true });
  const planPath = join(planning, "goofy-brewing-gadget.md"); const plan = "# plan\n"; writeFileSync(planPath, plan);
  const transcript = join(cwd, "live.jsonl");
  writeFileSync(transcript, JSON.stringify({ message: { content: [{ type: "text", text: "unrelated" }] } }));
  const result = run({
    tool_name: "ExitPlanMode", tool_use_id: "toolu-live", tool_input: {}, session_id: "live-session",
    transcript_path: transcript,
    tool_response: { plan, isAgent: false, filePath: planPath, hasTaskTool: false },
  }, cwd, "writing");
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(readFileSync(join(planning, ".state", "review.json"), "utf8"));
  assert.equal(receipt.plan_file, "goofy-brewing-gadget.md");
  assert.equal(receipt.workflow, "writing");
  assert.equal(receipt.approved_session_id, "live-session");
  assert.equal(receipt.status, "PENDING");
});

withProject((cwd) => {
  // No transcript at all: the synchronous source is sufficient on its own.
  const planning = join(cwd, ".planning"); mkdirSync(join(planning, ".state"), { recursive: true });
  const planPath = join(planning, "solo.md"); writeFileSync(planPath, "# solo\n");
  const result = run({ tool_name: "ExitPlanMode", tool_input: {}, session_id: "s", tool_response: { filePath: planPath } }, cwd, "writing");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(planning, ".state", "review.json"), "utf8")).plan_file, "solo.md");
});

withProject((cwd) => {
  mkdirSync(join(cwd, ".planning")); const outside = mkdtempSync(join(tmpdir(), "state-outside-"));
  try { symlinkSync(outside, join(cwd, ".planning", ".state")); const path = join(cwd, ".planning", "safe.md"); writeFileSync(path, "# safe\n"); const result = run(payload(cwd, path), cwd); assert.equal(result.status, 1); assert.match(result.stderr, /real directory/); }
  finally { rmSync(outside, { recursive: true, force: true }); }
});

for (const workflow of ["dev", "work", "writing", "workshop", "workflow-creator"]) withProject((cwd) => {
  mkdirSync(join(cwd, ".planning")); const path = join(cwd, ".planning", `${workflow}-generated.md`); writeFileSync(path, `# ${workflow}\n`);
  const result = run(payload(cwd, path, `${workflow}-approval`), cwd, workflow); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".planning", ".state", "review.json"), "utf8")).workflow, workflow);
  if (workflow === "dev") {
    for (const retired of ["PLAN.md", "SPEC.md", "SPEC_REVIEWED.md", "PLAN_REVIEWED.md", "REVIEW_STATE.md"]) {
      assert.equal(existsSync(join(cwd, ".planning", retired)), false, `dev must not create ${retired}`);
    }
  }
});

withProject((cwd) => {
  const planning = join(cwd, ".planning"); mkdirSync(planning);
  const path = join(planning, "external-generated.md"); writeFileSync(path, "# external generated\n");
  const descriptorPath = join(cwd, "workflow-policy.json");
  writeFileSync(descriptorPath, JSON.stringify({
    schemaVersion: 2,
    workflow: "opaque-native-extension",
    approvalMode: "generated-plan-receipt-v1",
    allowedOrchestratorDirectories: [".planning"],
  }));
  const result = run(payload(cwd, path), cwd, "", descriptorPath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(planning, ".state", "review.json"), "utf8")).workflow, "opaque-native-extension");
});

console.log("approved-artifact-persist tests passed");
