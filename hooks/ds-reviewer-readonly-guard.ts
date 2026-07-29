#!/usr/bin/env bun
/** PreToolUse guard: block Write/Edit during review phases.
 *
 * Review agents should be read-only. This hook blocks Write and Edit tool calls to prevent
 * reviewers from "fixing" issues they find.
 *
 * PreToolUse has NO top-level `decision` field — gates go through
 * hookSpecificOutput.permissionDecision. Emitting {"decision": ...} gets the whole payload rejected
 * by the harness ("Hook JSON output validation failed"), silently disabling this guard. Use the
 * shared helpers.
 */
import { allow, deny, readPayload } from "./_gate_common.ts";

const toolInput = await readPayload();
const toolName = String(toolInput.tool_name ?? "");

if (toolName === "Write" || toolName === "Edit") {
  // Allow workflow-state writes (verdict sentinels under .planning/.claude). The guard's intent is
  // to stop reviewers "fixing" the artifact under review or project code — NOT to block writing a
  // verdict sentinel like .planning/SPEC_REVIEWED.md. Mirrors phase-gate-guard's allowlist.
  const path = String(((toolInput.tool_input as Record<string, unknown>) ?? {}).file_path ?? "");
  const parts = path.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.length && (parts[0] === ".planning" || parts[0] === ".claude")) {
    allow();
  }
  deny(
    "\u{1f6d1} Reviewer read-only enforcement: Review/verification agents must NOT modify files. Report findings back to the orchestrator for planned fixes. (Writes to .planning/ verdict sentinels are allowed.)",
  );
} else {
  allow();
}
