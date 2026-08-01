#!/usr/bin/env bun
/** PreToolUse guard: block Read/Grep on non-.planning/ files after subagent return.
 *
 * Checks the flag file set by ds-post-subagent-guard.py. If set, blocks Read/Grep on paths that are
 * NOT under .planning/.
 *
 * PreToolUse has NO top-level `decision` field — gates go through
 * hookSpecificOutput.permissionDecision. Emitting {"decision": ...} gets the whole payload rejected
 * by the harness ("Hook JSON output validation failed"), silently disabling this guard. Use the
 * shared helpers.
 */
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { allow, deny, denyOnCrash, readPayload, sessionFlagKey } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("DS READ-AFTER-SUBAGENT GUARD");

/**
 * Port of Python's `tempfile.gettempdir()` resolution order.
 *
 * Hardcoding "/tmp" or `os.tmpdir()` here makes the flag file unreachable whenever TMPDIR is set —
 * the deny branch would never fire and the guard would silently degrade to allow-only. Python
 * checks TMPDIR, TEMP, TMP, then /tmp, /var/tmp, /usr/tmp, then the cwd, taking the first usable
 * one, and leaves os.curdir (".") un-abspath'd.
 */
function gettempdir(): string {
  const candidates: string[] = [];
  for (const name of ["TMPDIR", "TEMP", "TMP"]) {
    const v = process.env[name];
    if (v) candidates.push(v);
  }
  candidates.push("/tmp", "/var/tmp", "/usr/tmp", process.cwd());
  for (const c of candidates) {
    try {
      if (!statSync(c).isDirectory()) continue;
      accessSync(c, constants.W_OK);
      return c;
    } catch {
      continue;
    }
  }
  return process.cwd();
}

const hookInput = await readPayload();
const toolName = String(hookInput.tool_name ?? "");
const toolParams = (hookInput.tool_input as Record<string, unknown>) ?? {};

// Check if subagent has returned
const flagDir = join(gettempdir(), "ds-workflow-flags");
// Keyed to the payload session so it finds the flag its PostToolUse counterpart wrote. The old
// process.env.CLAUDE_SESSION_ID is never set by Claude Code, so this resolved to "default" and
// one session's returning subagent blocked reads in every other session. See sessionFlagKey.
const sessionId = sessionFlagKey(hookInput);
const flagFile = join(flagDir, `subagent-returned-${sessionId}`);

if (!existsSync(flagFile)) {
  // No subagent has returned yet — allow everything
  allow();
}

// Subagent has returned — check if this is a read on non-state files
let path = "";
if (toolName === "Read") path = String(toolParams.file_path ?? "");
else if (toolName === "Grep") path = String(toolParams.path ?? "");
else if (toolName === "Glob") path = String(toolParams.path ?? "");

if (!path) {
  allow();
}

// Allow reads of state files (.planning/), plugin files, and common config
const allowedPatterns = [".planning/", ".claude/", "CLAUDE.md", "plugins/cache/"];
if (allowedPatterns.some((p) => path.includes(p))) {
  allow();
}

// Block reads of source/data files after subagent return
deny(
  "\u{1f6d1} Post-subagent boundary (C5): After a subagent returns, main chat must NOT read source/data files. Verify via .planning/ state files only. If you need to investigate further, dispatch a NEW subagent.",
);
