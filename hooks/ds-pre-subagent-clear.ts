#!/usr/bin/env bun
/** PreToolUse guard: clear post-subagent flag before dispatching a new subagent.
 *
 * When a new Agent/Task is about to be dispatched, clear the flag file so that
 * reads needed to prepare the subagent prompt are not blocked.
 *
 * PreToolUse has NO top-level `decision` field — gates go through
 * hookSpecificOutput.permissionDecision. Emitting {"decision": ...} gets the whole payload rejected
 * by the harness ("Hook JSON output validation failed"), silently disabling this guard. Use the
 * shared helpers.
 *
 * The hook never reads stdin (the Python original doesn't either) and has no deny path.
 */
import { existsSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { allow, readPayload, sessionFlagKey } from "./_gate_common.ts";

/**
 * Port of Python's `tempfile.gettempdir()`.
 *
 * Load-bearing: the flag file lives under the temp dir, so a port that hardcodes "/tmp" (or uses
 * `os.tmpdir()`, which ignores TMPDIR on some platforms and does NOT resolve a relative value
 * against cwd) deletes a different path than the Python original. Python builds a candidate list
 * from TMPDIR/TEMP/TMP then the posix defaults then cwd, `abspath()`s each candidate (so a relative
 * TMPDIR like "." becomes <cwd>), and picks the first one it can actually create a file in.
 */
function gettempdir(): string {
  const candidates: string[] = [];
  for (const name of ["TMPDIR", "TEMP", "TMP"]) {
    const v = process.env[name];
    if (v) candidates.push(v);
  }
  candidates.push("/tmp", "/var/tmp", "/usr/tmp");
  try {
    candidates.push(process.cwd());
  } catch {
    /* cwd may not exist */
  }

  for (const cand of candidates) {
    const dir = resolve(cand);
    try {
      const probe = mkdtempSync(join(dir, "tmp"));
      rmdirSync(probe);
      return dir;
    } catch {
      continue;
    }
  }
  throw new Error("Could not find a usable temporary directory name");
}

const flagDir = join(gettempdir(), "ds-workflow-flags");
// The payload is now read for one reason only: its session_id is the per-session flag key. The
// old process.env.CLAUDE_SESSION_ID is never set by Claude Code, so this resolved to "default"
// and cleared every concurrent session's flag at once. See sessionFlagKey.
const sessionId = sessionFlagKey(await readPayload());
const flagFile = join(flagDir, `subagent-returned-${sessionId}`);

if (existsSync(flagFile)) {
  rmSync(flagFile);
}

allow();
