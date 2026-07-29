#!/usr/bin/env bun
import { parsePayload } from "./_gate_common.ts";
/**
 * Stop hook: Update LEARNINGS.md timestamp when session ends.
 *
 * Port of session-end.py. Never blocks: stdout is always empty, exit is always 0. The only
 * observable effect is the rewrite of $CWD/.claude/LEARNINGS.md.
 */

/**
 * Python's `str.rstrip()` — strips every trailing character for which `str.isspace()` is true.
 * `String.prototype.trimEnd` is close but NOT identical (it also strips ﻿, which Python does
 * not treat as whitespace), so the character class is spelled out.
 */
function pyRstrip(s: string): string {
  return s.replace(
    /[ \t\n\r\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/,
    "",
  );
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function nowStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * Python: re.sub(r'\n---\nLast updated:.*\n---\n?$', '', content)
 *
 * `.` is [^\n] (no re.S) and `$` without re.M matches at end of string OR just before a single
 * trailing newline — JS `$` (no /m) matches only the absolute end, so the Python `$` is spelled
 * out as the lookahead `(?=\n?$)`. Anchored at the end, so a mid-file footer survives.
 */
const FOOTER_RE = /\n---\nLast updated:[^\n]*\n---\n?(?=\n?$)/;

async function updateLearningsTimestamp(learningsPath: string): Promise<boolean> {
  const timestamp = nowStamp();
  const footer = `\n---\nLast updated: ${timestamp}\n---\n`;

  try {
    let content = await Bun.file(learningsPath).text();
    content = content.replace(FOOTER_RE, "");
    content = pyRstrip(content) + footer;
    await Bun.write(learningsPath, content);
    return true;
  } catch (e) {
    // Mirrors the Python `except (IOError, OSError)` branch.
    process.stderr.write(`[SessionEnd] Failed to update LEARNINGS.md: ${(e as Error)?.message ?? e}\n`);
    return false;
  }
}

async function main(): Promise<never> {
  // Read hook input (optional - may not have session info)
  try {
    parsePayload(await Bun.stdin.text());
  } catch {
    // json.JSONDecodeError / KeyError fallback: session_id is unused past this point.
  }

  const learningsPath = `${process.cwd()}/.claude/LEARNINGS.md`;
  if (await Bun.file(learningsPath).exists()) {
    if (await updateLearningsTimestamp(learningsPath)) {
      process.stderr.write(`[SessionEnd] Updated ${learningsPath}\n`);
    }
  }

  process.exit(0);
}

await main();
