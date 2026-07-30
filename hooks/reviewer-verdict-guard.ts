#!/usr/bin/env bun
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { parseVerdict, sha256 } from "../workflows/lib/approved-artifact.ts";
import { safeExactTarget, safeProjectPath, hasUnsafeCompoundCommand } from "./_path_safety.ts";
import { workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, readPayload } from "./_gate_common.ts";

const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Reviewer verdict guard requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy."); }
const payload = await readPayload();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
const reason = "Reviewer read-only enforcement: return findings without modifying artifacts, state, or project files.";
if (tool === "Edit") deny(reason);
if (tool === "Write") {
  const requested = safeProjectPath(cwd, input.file_path);
  const verdictPath = join(cwd, policy.reviewerVerdict);
  try { if (!requested || lstatSync(requested).isSymbolicLink() || !safeExactTarget(cwd, requested, verdictPath)) deny(reason); } catch { if (!requested || !safeExactTarget(cwd, requested, verdictPath)) deny(reason); }
  const verdict = parseVerdict(input.content);
  const planPath = join(cwd, ".planning", "PLAN.md");
  let planHash: string | null = null;
  try { planHash = sha256(await Bun.file(planPath).arrayBuffer()); } catch { /* fail closed below */ }
  if ("code" in verdict || verdict.reviewer_session_id !== process.env.CLAUDE_SESSION_ID || !planHash || verdict.plan_hash !== planHash) {
    deny("PLAN_REVIEWED.md must record the current PLAN.md hash and this reviewer's actual session ID in strict hash-bound YAML frontmatter.");
  }
  allow();
}
if (tool === "Bash") {
  const command = String(input.command ?? "").trim();
  const hashCommand = /^(sha256sum|shasum -a 256) (\.\/)?\.planning\/PLAN\.md$/;
  if (!hasUnsafeCompoundCommand(command) && hashCommand.test(command) && existsSync(join(cwd, ".planning", "PLAN.md"))) allow();
  deny("Reviewer Bash enforcement: only sha256sum .planning/PLAN.md is permitted; return findings without mutation.");
}
allow();
