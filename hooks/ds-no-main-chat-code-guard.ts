#!/usr/bin/env bun
/** PreToolUse guard: block Write/Edit/Bash on analysis files in main chat during ds-implement.
 *
 * The Iron Law: YOU MUST NOT WRITE ANALYSIS CODE IN MAIN CHAT.
 * Analysis code must be written by delegated subagents, not the orchestrator.
 *
 * PreToolUse has NO top-level `decision` field — gates go through
 * hookSpecificOutput.permissionDecision. Emitting {"decision": ...} gets the whole payload rejected
 * by the harness ("Hook JSON output validation failed"), silently disabling this guard. Use the
 * shared helpers.
 */
import { allow, deny, readPayload } from "./_gate_common.ts";

const toolInput = await readPayload();
const toolName = String(toolInput.tool_name ?? "");
const toolParams = (toolInput.tool_input as Record<string, unknown>) ?? {};

// Only check Write, Edit, and Bash
if (toolName !== "Write" && toolName !== "Edit" && toolName !== "Bash") {
  allow();
}

// For Bash, check if command contains analysis-related operations
if (toolName === "Bash") {
  const command = String(toolParams.command ?? "");
  // Allow git, ls, cat .planning/, check-all-ds.sh, and other orchestration commands
  const safePrefixes = ["git ", "ls ", "cat .planning/", "head ", "tail ", "wc ", "mkdir ", "chmod ", "bash scripts/"];
  if (safePrefixes.some((p) => command.trim().startsWith(p))) {
    allow();
  }
  // Allow pixi/python commands that are just running scripts
  if (command.includes("check-all-ds") || command.includes("check-ds-")) {
    allow();
  }
  // Block python/pixi run commands that look like analysis
  if (["python3 -c", "pixi run python", "import pandas", "import numpy"].some((kw) => command.includes(kw))) {
    deny("\u{1f6d1} Iron Law: No analysis code in main chat. Delegate to a subagent via ds-delegate.");
  }
  allow();
}

// For Write/Edit, check if target is an analysis file
const path = String(toolParams.file_path ?? "");

// Allow writes to state files, planning, config
const allowedPatterns = [".planning/", ".claude/", "CLAUDE.md", "scripts/", "hooks/", "references/", "skills/"];
if (allowedPatterns.some((pattern) => path.includes(pattern))) {
  allow();
}

// Block writes to analysis files (.py, .ipynb, .R, .sas, .sql in project dirs)
const analysisExtensions = [".py", ".ipynb", ".R", ".r", ".sas", ".sql", ".qmd"];
if (analysisExtensions.some((ext) => path.endsWith(ext))) {
  deny(
    "\u{1f6d1} Iron Law: No analysis code in main chat. This file should be written by a delegated subagent. Use ds-delegate to dispatch a Task agent.",
  );
}

allow();
