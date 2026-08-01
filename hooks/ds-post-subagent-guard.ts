#!/usr/bin/env bun
/** PostToolUse guard: after Agent/Task returns, block Read/Grep on non-state files.
 *
 * Sets a flag file when a subagent completes. A PreToolUse hook then checks
 * this flag and blocks Read/Grep on non-.planning/ paths.
 *
 * This is a simplified version — the flag is set per-session via an env-based temp file.
 *
 * PORT NOTES — the two places a "cleaner" TypeScript version silently breaks the guard:
 *   1. The session key must match the PreToolUse readers byte for byte, or the guard stops
 *      guarding silently. It is no longer read from process.env.CLAUDE_SESSION_ID at all —
 *      Claude Code never sets that variable, so all three hooks resolved to "default" and shared
 *      one flag file across every concurrent session. sessionFlagKey owns the derivation.
 *   2. A non-object payload must CRASH (exit 1, no flag). Python reaches `.get` on a str and
 *      raises AttributeError before the write. Defensively coercing to {} would arm the
 *      PreToolUse blocker off a malformed payload.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionFlagKey } from "./_gate_common.ts";

/** Python's tempfile.gettempdir(): TMPDIR, TEMP, TMP, then the platform dirs, then cwd. */
function gettempdir(): string {
  for (const key of ["TMPDIR", "TEMP", "TMP"]) {
    const v = process.env[key];
    if (v) return v;
  }
  for (const d of ["/tmp", "/var/tmp", "/usr/tmp"]) {
    try {
      mkdirSync(d, { recursive: true });
      return d;
    } catch {
      /* try the next candidate, as Python does */
    }
  }
  return process.cwd();
}

const raw = await Bun.stdin.text();
const payload: unknown = JSON.parse(raw);

// Mirrors Python's `tool_input.get("tool_name", "")` on a non-dict: AttributeError -> exit 1,
// empty stdout, and crucially NO flag file.
if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
  process.stderr.write(
    `AttributeError: '${typeof payload}' object has no attribute 'get'\n`,
  );
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _toolName = String((payload as Record<string, unknown>).tool_name ?? "");

// This hook fires PostToolUse on Agent/Task
// Set a flag file indicating subagent has returned
const flagDir = join(gettempdir(), "ds-workflow-flags");
mkdirSync(flagDir, { recursive: true });

// Keyed to the payload session, not to process.env.CLAUDE_SESSION_ID: Claude Code never sets that
// variable, so this always resolved to the literal "default" and every concurrent session shared
// one flag file. See sessionFlagKey.
const sessionId = sessionFlagKey(payload);
const flagFile = join(flagDir, `subagent-returned-${sessionId}`);

writeFileSync(flagFile, "1");

// Nothing to say. PostToolUse accepts a top-level "decision", but ONLY the value
// "block" -- {"decision": "allow"} is rejected as invalid and the whole payload is
// dropped. Staying silent is how a PostToolUse hook says "carry on".
process.exit(0);
