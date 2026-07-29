#!/usr/bin/env bun
/**
 * PreToolUse hook: Enforce delegation — deny Write/Edit on project code files.
 *
 * The Iron Law of Delegation: main chat orchestrates, subagents implement.
 * Main chat may only Write/Edit workflow state files (.planning/, .claude/).
 * All other file writes must be delegated to subagents.
 *
 * Scoped to dev and dev-debug skills (top-level only).
 * Grounded in: March 16, 2026 incident — 71 protocol violations when main chat
 * "verified" subagent work by reading/editing source code directly.
 */
import { allow, deny, readPayload } from "./_gate_common.ts";

const ALLOWED_DIRS = [".planning", ".claude"];

/**
 * Membership test over Python's `Path(file_path).parts`.
 *
 * `.parts` is NOT a prefix check — the allowed dir may sit anywhere in the path
 * (e.g. /home/eh/projects/workflows/.claude/settings.json). PurePath also drops
 * bare "." components and collapses repeated separators, so filter those out.
 */
function isAllowedPath(filePath: string): boolean {
  const parts = filePath.split("/").filter((p) => p !== "" && p !== ".");
  return ALLOWED_DIRS.some((d) => parts.includes(d));
}

let hookInput: Record<string, unknown>;
try {
  hookInput = await readPayload();
} catch {
  // Mirrors the Python `except: sys.exit(0)` around json.load.
  allow();
}

const toolName = String(hookInput.tool_name ?? "");
const toolInput = (hookInput.tool_input as Record<string, unknown>) ?? {};

if (toolName !== "Write" && toolName !== "Edit") allow();

const filePath = String(toolInput.file_path ?? "");
if (!filePath) allow();

if (isAllowedPath(filePath)) allow();

deny(
  "DELEGATION VIOLATION: Main chat cannot Write/Edit project files.\n\n" +
    `Attempted: ${toolName} on \`${filePath}\`\n\n` +
    "The Iron Law of Delegation: main chat orchestrates, subagents implement.\n" +
    "Spawn a Task agent to make this change instead.\n\n" +
    "Allowed in main chat: .planning/* and .claude/* only.",
);
