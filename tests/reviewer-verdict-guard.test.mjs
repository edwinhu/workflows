import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "reviewer-verdict-guard.ts");
const planFile = "jazzy-leaping-scroll.md";
const plan = "# Exact generated plan\n";
const hash = createHash("sha256").update(plan).digest("hex");
const pending = { workflow: "ds", plan_file: planFile, plan_hash: hash, approved_session_id: "approval-123", approved_at: "2026-01-01T00:00:00.000Z", status: "PENDING", reviewer_session_id: "", reviewed_at: "" };
function final(overrides = {}) { return JSON.stringify({ ...pending, status: "APPROVED", reviewer_session_id: REVIEWER_ACTOR, reviewed_at: "2026-01-01T00:01:00.000Z", ...overrides }, null, 2); }
function devVerdict() { return `---\nplan_hash: ${hash}\nstatus: APPROVED\nreviewer_session_id: ${REVIEWER_ACTOR}\nreviewed_at: 2026-01-01T00:01:00.000Z\n---\n`; }
function externalWorkflowPolicy(reviewerVerdict) {
  return {
    schemaVersion: 1,
    workflow: "external-review",
    clarifySentinel: ".planning/EXTERNAL_CLARIFIED.json",
    clarifyReason: "Clarify the external workflow before review.",
    reviewerVerdict,
    approvalPolicy: ".planning/approval-policy.json",
    allowedOrchestratorDirectories: [".planning"],
  };
}
function generatedPlanWorkflowPolicy() {
  return {
    schemaVersion: 2,
    workflow: "external-review",
    approvalMode: "generated-plan-receipt-v1",
    allowedOrchestratorDirectories: [".planning"],
  };
}
function externalApprovalPolicy(verdictPath = ".planning/PLAN_REVIEWED.md") {
  return { schemaVersion: 1, workflow: "external-review", planPath: ".planning/PLAN.md", metadataPath: ".planning/PLAN.meta.json", verdictPath };
}
function externalMetadata(overrides = {}) {
  return { schemaVersion: 1, workflow: "external-review", planHash: hash, approvedSession: "approval-123", approvedAt: "2026-01-01T00:00:00.000Z", ...overrides };
}
// Reviewer identity comes from the payload (session_id + agent_id), never from the environment:
// Claude Code does not set CLAUDE_SESSION_ID, so injecting it here simulated a variable production
// never provides — which is why these cases passed while every real finalization denied.
// "approval-123" is the approving conversation; the reviewer is a subagent it dispatched.
const REVIEWER_ACTOR = "approval-123#agent-456";
function run(cwd, { workflow = "ds", workflowPolicy = "", tool = "Write", filePath = ".planning/.state/review.json", content = final(), command = "" } = {}) {
  const toolInput = tool === "Bash" ? { command } : { file_path: filePath, content };
  const argv = workflowPolicy ? [HOOK, "--workflow-policy", workflowPolicy] : [HOOK, "--workflow", workflow];
  const env = { ...process.env }; delete env.CLAUDE_SESSION_ID;
  const stdin = { session_id: "approval-123", agent_id: "agent-456", agent_type: "general-purpose", cwd, hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput };
  return spawnSync("bun", argv, { cwd, env, input: JSON.stringify(stdin), encoding: "utf8" });
}
// An allow is the absence of a deny, not necessarily empty stdout: the permitted pre-finalization
// hash call also carries the reviewer's actor identity as PreToolUse additionalContext, which is
// the only way a subagent can learn its own agent_id.
function allowed(result, message) { assert.equal(result.status, 0, `${message}: ${result.stderr}`); assert.doesNotMatch(result.stdout, /"permissionDecision"/, `${message}: ${result.stdout}`); }
function denied(result, message) { assert.equal(result.status, 0, `${message}: ${result.stderr}`); assert.match(result.stdout, /"permissionDecision": "deny"/, message); }

const cwd = mkdtempSync(join(tmpdir(), "reviewer-guard-")); const outside = mkdtempSync(join(tmpdir(), "reviewer-guard-outside-"));
try {
  const planning = join(cwd, ".planning"); mkdirSync(join(planning, ".state"), { recursive: true }); writeFileSync(join(planning, planFile), plan); writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(pending));
  for (const path of [".planning/.state/review.json", "./.planning/.state/review.json", join(planning, ".state", "review.json")]) allowed(run(cwd, { filePath: path }), `final target ${path}`);
  denied(run(cwd, { filePath: ".planning/PLAN_REVIEWED.md" }), "visible verdict is retired");
  denied(run(cwd, { filePath: `.planning/${planFile}` }), "reviewer cannot modify plan bytes");
  denied(run(cwd, { tool: "Edit" }), "reviewer must replace receipt atomically through Write only");
  denied(run(cwd, { content: final({ plan_hash: "a".repeat(64) }) }), "hash immutable");
  denied(run(cwd, { content: final({ plan_file: "other.md" }) }), "path immutable");
  denied(run(cwd, { content: final({ approved_session_id: "forged" }) }), "approval identity immutable");
  denied(run(cwd, { content: final({ approved_at: "2025-01-01T00:00:00.000Z" }) }), "approval time immutable");
  denied(run(cwd, { content: final({ reviewer_session_id: "other" }) }), "actual reviewer session required");
  denied(run(cwd, { content: final({ reviewed_at: "2025-01-01T00:00:00.000Z" }) }), "chronology required");
  denied(run(cwd, { content: JSON.stringify(pending) }), "reviewer cannot leave PENDING");
  denied(run(cwd, { content: final().replace('"plan_hash":', `"plan_hash": "${hash}",\n  "plan_hash":`) }), "duplicate JSON key rejected");
  allowed(run(cwd, { tool: "Bash", command: `sha256sum .planning/${planFile}` }), "may hash exact selected plan");
  denied(run(cwd, { tool: "Bash", command: "sha256sum .planning/other.md" }), "may not hash decoy");
  denied(run(cwd, { tool: "Bash", command: `sha256sum .planning/${planFile} && true` }), "compound denied");

  const selected = join(planning, planFile);
  const internalTarget = join(planning, "internal-target.md"); writeFileSync(internalTarget, plan); rmSync(selected); symlinkSync(internalTarget, selected);
  denied(run(cwd), "internal symlinked selected plan denied");
  rmSync(selected); writeFileSync(join(outside, "external-target.md"), plan); symlinkSync(join(outside, "external-target.md"), selected);
  denied(run(cwd), "external symlinked selected plan denied");
  rmSync(selected); writeFileSync(selected, plan);

  const devPending = { ...pending, workflow: "dev" };
  const devFinal = JSON.stringify({ ...devPending, status: "APPROVED", reviewer_session_id: REVIEWER_ACTOR, reviewed_at: "2026-01-01T00:01:00.000Z" }, null, 2);
  writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(devPending));
  allowed(run(cwd, { workflow: "dev", filePath: ".planning/.state/review.json", content: devFinal }), "dev finalizes hidden native receipt");
  allowed(run(cwd, { workflow: "dev", tool: "Bash", command: `sha256sum .planning/${planFile}` }), "dev hashes selected generated plan");
  denied(run(cwd, { workflow: "dev", filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict() }), "dev visible fixed verdict is conversion-only");
  writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(pending));

  const generatedWorkflowPolicyPath = join(cwd, "generated-workflow-policy.json");
  const generatedPending = { ...pending, workflow: "external-review" };
  // REVIEWER_ACTOR, not the env-era "reviewer-456": the schema-v2 external generated-plan route
  // finalizes through the same payload-derived identity as every built-in, so a literal that only
  // ever matched process.env.CLAUDE_SESSION_ID denies here exactly as it did in production.
  const generatedFinal = JSON.stringify({ ...generatedPending, status: "APPROVED", reviewer_session_id: REVIEWER_ACTOR, reviewed_at: "2026-01-01T00:01:00.000Z" }, null, 2);
  writeFileSync(generatedWorkflowPolicyPath, JSON.stringify(generatedPlanWorkflowPolicy()));
  writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(generatedPending));
  allowed(run(cwd, { workflowPolicy: generatedWorkflowPolicyPath, filePath: ".planning/.state/review.json", content: generatedFinal }), "schema-v2 external workflow finalizes generated-plan receipt");
  denied(run(cwd, { workflowPolicy: generatedWorkflowPolicyPath, filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict() }), "schema-v2 external workflow has no fixed reviewer verdict path");

  writeFileSync(join(planning, ".state", "review.json"), JSON.stringify(pending));
  writeFileSync(join(planning, "PLAN.md"), plan);
  const approvalPolicyPath = join(planning, "approval-policy.json");
  const matchingWorkflowPolicyPath = join(cwd, "external-workflow-policy.json");
  const mismatchedWorkflowPolicyPath = join(cwd, "external-workflow-policy-mismatch.json");
  writeFileSync(approvalPolicyPath, JSON.stringify(externalApprovalPolicy()));
  writeFileSync(join(planning, "PLAN.meta.json"), JSON.stringify(externalMetadata()));
  writeFileSync(matchingWorkflowPolicyPath, JSON.stringify(externalWorkflowPolicy(".planning/PLAN_REVIEWED.md")));
  writeFileSync(mismatchedWorkflowPolicyPath, JSON.stringify(externalWorkflowPolicy(".planning/OTHER_REVIEWED.md")));
  allowed(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict() }), "external schema-v1 verdict path agreement allows fixed PLAN.md review");
  allowed(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, tool: "Bash", command: "sha256sum .planning/PLAN.md" }), "external schema-v1 reviewer may hash descriptor PLAN.md");
  denied(run(cwd, { workflowPolicy: mismatchedWorkflowPolicyPath, filePath: ".planning/OTHER_REVIEWED.md", content: devVerdict() }), "external policy and approval descriptor verdict paths must match exactly");
  const collidingWorkflowPolicyPath = join(cwd, "external-workflow-policy-colliding.json");
  writeFileSync(collidingWorkflowPolicyPath, JSON.stringify(externalWorkflowPolicy(".planning/PLAN.md")));
  writeFileSync(approvalPolicyPath, JSON.stringify(externalApprovalPolicy(".planning/PLAN.md")));
  denied(run(cwd, { workflowPolicy: collidingWorkflowPolicyPath, filePath: ".planning/PLAN.md", content: devVerdict() }), "external plan, metadata, and verdict paths must be distinct");
  writeFileSync(approvalPolicyPath, JSON.stringify(externalApprovalPolicy()));
  denied(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict().replace("2026-01-01T00:01:00.000Z", "2026-01-01T00:00:00.000Z") }), "external review must be later than approval");
  writeFileSync(join(planning, "PLAN.meta.json"), "{}\n");
  denied(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict() }), "external review requires valid approval metadata");
  writeFileSync(join(planning, "PLAN.meta.json"), JSON.stringify(externalMetadata()));

  const externalPlan = join(planning, "PLAN.md");
  const internalPlanTarget = join(planning, "external-plan-target.md");
  writeFileSync(internalPlanTarget, plan); rmSync(externalPlan); symlinkSync(internalPlanTarget, externalPlan);
  denied(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict() }), "external descriptor plan cannot be an internal symlink");
  rmSync(externalPlan); writeFileSync(join(outside, "external-plan.md"), plan); symlinkSync(join(outside, "external-plan.md"), externalPlan);
  denied(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, tool: "Bash", command: "sha256sum .planning/PLAN.md" }), "external descriptor plan cannot escape through a symlink");
  rmSync(externalPlan); writeFileSync(externalPlan, plan);

  rmSync(join(planning, "PLAN_REVIEWED.md"), { force: true });
  writeFileSync(join(outside, "external-verdict.md"), devVerdict());
  symlinkSync(join(outside, "external-verdict.md"), join(planning, "PLAN_REVIEWED.md"));
  denied(run(cwd, { workflowPolicy: matchingWorkflowPolicyPath, filePath: ".planning/PLAN_REVIEWED.md", content: devVerdict() }), "external verdict target cannot be a symlink");
  rmSync(join(planning, "PLAN_REVIEWED.md"), { force: true });

  rmSync(join(planning, ".state", "review.json")); symlinkSync(join(outside, "missing.json"), join(planning, ".state", "review.json")); denied(run(cwd), "symlinked receipt denied");
} finally { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
console.log("reviewer-verdict-guard tests passed");
