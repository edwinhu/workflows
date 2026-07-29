#!/usr/bin/env bun
/**
 * PreToolUse hook: Suggest manual compaction at strategic intervals.
 *
 * Tracks Edit/Write tool calls and suggests /compact at logical checkpoints.
 * Manual compaction at strategic points (after exploration, before execution)
 * preserves more context than auto-compact which happens at arbitrary points.
 *
 * Configuration via environment:
 * - COMPACT_THRESHOLD: Tool calls before first suggestion (default: 50)
 * - COMPACT_INTERVAL: Tool calls between subsequent suggestions (default: 25)
 *
 * PORT NOTE: the counter file lives in the SYSTEM temp dir, not cwd. Python resolves it with
 * tempfile.gettempdir(), which honors $TMPDIR (and accepts a relative value). This port must
 * resolve the same directory the same way or the two implementations write to different files.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { context } from "./_gate_common.ts";

/** tempfile.gettempdir() equivalent: $TMPDIR, $TEMP, $TMP, then /tmp — no trailing-slash mangling. */
function getTempDir(): string {
  return process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
}

/** Session-specific counter file path. */
function getCounterFile(): string {
  const sessionId = process.env.CLAUDE_SESSION_ID ?? String(process.ppid);
  return join(getTempDir(), `claude-tool-count-${sessionId}`);
}

/** Python `int(text)`: optional sign, decimal digits, surrounding whitespace already stripped. */
function pyInt(text: string): number | null {
  return /^[+-]?[0-9]+$/.test(text) ? Number(text) : null;
}

function readCounter(): number {
  const counterFile = getCounterFile();
  if (existsSync(counterFile)) {
    try {
      const n = pyInt(readFileSync(counterFile, "utf8").trim());
      if (n !== null) return n;
    } catch {
      // ValueError / IOError -> fall through to 0, exactly as the Python does.
    }
  }
  return 0;
}

function writeCounter(count: number): void {
  try {
    writeFileSync(getCounterFile(), String(count));
  } catch {
    // IOError: pass
  }
}

let hookInput: Record<string, unknown>;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

const toolName = String(hookInput.tool_name ?? "");

// Only count Edit and Write operations
if (toolName !== "Edit" && toolName !== "Write") {
  process.exit(0);
}

// Increment counter
const count = readCounter() + 1;
writeCounter(count);

// Get thresholds from environment
const threshold = Number(process.env.COMPACT_THRESHOLD ?? "50");
const interval = Number(process.env.COMPACT_INTERVAL ?? "25");

let message: string | null = null;

if (count === threshold) {
  message = `[StrategicCompact] ${threshold} edits reached - consider /compact if transitioning phases`;
} else if (count > threshold && (count - threshold) % interval === 0) {
  message = `[StrategicCompact] ${count} edits - good checkpoint for /compact if context is stale`;
}

if (message) {
  // hookEventName MUST match the event this hook was actually invoked on, or the harness rejects
  // the payload and the suggestion is dropped. This hook is wired to PreToolUse (hooks/hooks.json)
  // AND to PostToolUse (skills/workshop, skills/workshop-revise), so hardcoding "PreToolUse"
  // silently broke it under the workshop wiring. Read the event from the payload instead.
  const event = String(hookInput.hook_event_name || "PreToolUse");
  context(event, message);
}

process.exit(0);
