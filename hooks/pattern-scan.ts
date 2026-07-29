#!/usr/bin/env bun
/**
 * SessionEnd hook: Scan transcript for user correction patterns.
 *
 * Writes pending-patterns.json if repeated corrections detected.
 * The SessionStart hook reads this file and suggests /pattern-capture.
 *
 * Must complete within 1.5s (SessionEnd default timeout).
 *
 * PORT NOTES (behavior-preserving, not a refactor):
 *   - The file this hook writes is `json.dumps(pending, indent=2)`. `JSON.stringify(o, null, 2)`
 *     is NOT byte-identical: Python's `ensure_ascii=True` escapes every non-ASCII code unit, so a
 *     transcript containing "café 😡" serializes differently in the two languages while looking
 *     identical in a terminal. `pyJson` (from _gate_common) does the escaping; `dumpIndent` below
 *     adds Python's indent layout on top of it.
 *   - Truncation is `text[:200]` — Python counts code POINTS, JS `slice` counts UTF-16 code UNITS,
 *     so an astral char near the boundary would split differently. Iterate code points.
 *   - `Path.home()` honors $HOME (via expanduser); Node's `os.homedir()` does too on POSIX, but
 *     $HOME is read explicitly here so the resolution rule is stated rather than assumed.
 *   - A transcript line (or a stdin payload) that is valid JSON but not an object makes Python's
 *     `.get()` raise AttributeError and the process exit 1. That crash is behavior too — it is
 *     reproduced rather than "fixed".
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pyJson } from "./_gate_common.ts";

// Regexes that indicate user corrections (case-insensitive)
const CORRECTION_PATTERNS = [
  String.raw`\bno[,.]?\s+(don'?t|stop|not|never|instead|again)\b`,
  String.raw`\bi\s+(already|just)\s+(told|said|asked|mentioned)\b`,
  String.raw`\b(wrong|incorrect|that'?s not|not what i)\b`,
  String.raw`\byou keep\b`,
  String.raw`\bagain[,.]?\s+(don'?t|please|stop)\b`,
  String.raw`\bi keep (telling|saying|asking|having to)\b`,
  String.raw`\bhow many times\b`,
];

const COMPILED_PATTERNS = CORRECTION_PATTERNS.map((p) => ({ pattern: p, re: new RegExp(p, "i") }));

/** `json.dumps(value, indent=2)` — Python's layout, Python's escaping (via pyJson). */
function dumpIndent(value: unknown, level = 0): string {
  const pad = "  ".repeat(level + 1);
  const closePad = "  ".repeat(level);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "[\n" + value.map((v) => pad + dumpIndent(v, level + 1)).join(",\n") + "\n" + closePad + "]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return (
      "{\n" +
      entries.map(([k, v]) => `${pad}${pyJson(k)}: ${dumpIndent(v, level + 1)}`).join(",\n") +
      "\n" +
      closePad +
      "}"
    );
  }
  return pyJson(value);
}

/** Python truthiness: '' / 0 / null / false / empty container are falsy. */
function pyTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === "" || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return Boolean(v);
}

/** `.get()` on a non-dict raises AttributeError in Python — exit 1, not a silent default. */
function pyGet(obj: unknown, key: string, dflt: unknown = undefined): unknown {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError(`AttributeError: object has no attribute 'get' (${key})`);
  }
  const v = (obj as Record<string, unknown>)[key];
  return v === undefined ? dflt : v;
}

function pyHome(): string {
  return process.env.HOME ?? homedir();
}

/**
 * Get project-scoped pending patterns file path.
 *
 * Uses the same project directory convention as Claude Code:
 * ~/.claude/projects/-Users-foo-projects-bar/pending-patterns.json
 */
function getPendingFile(cwd: string): string {
  if (!cwd) return join(pyHome(), ".claude", "pending-patterns.json");

  // Claude Code encodes project path by replacing / with -
  // e.g., /Users/foo/projects/bar -> -Users-foo-projects-bar  (leading dash kept)
  const projectSlug = cwd.split("/").join("-");
  return join(pyHome(), ".claude", "projects", projectSlug, "pending-patterns.json");
}

type Correction = { text: string; line: number; pattern: string };

/** Scan JSONL transcript for user correction messages. */
function scanTranscript(transcriptPath: string): Correction[] {
  const corrections: Correction[] = [];
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch (e) {
    // Python catches (IOError, OSError) around the whole read loop.
    console.error(`[PatternScan] Failed to read transcript: ${(e as Error).message}`);
    return corrections;
  }

  // Python iterates file lines: a trailing newline does NOT yield a final empty line.
  const lines = raw.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let entry: unknown;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    // Only look at user messages (human turns)
    if (pyGet(entry, "type") !== "human") continue;

    // Extract text content
    const content = pyGet(entry, "content", "");
    let text: string;
    if (Array.isArray(content)) {
      // Content blocks format
      const textParts: string[] = [];
      for (const block of content) {
        if (block !== null && typeof block === "object" && !Array.isArray(block)) {
          if ((block as Record<string, unknown>).type === "text") {
            textParts.push(String((block as Record<string, unknown>).text ?? ""));
          }
        } else if (typeof block === "string") {
          textParts.push(block);
        }
      }
      text = textParts.join(" ");
    } else if (typeof content === "string") {
      text = content;
    } else {
      continue;
    }

    if (!text.trim()) continue;

    // Check against correction patterns
    for (const { pattern, re } of COMPILED_PATTERNS) {
      if (re.test(text)) {
        // Truncate for storage — code POINTS, matching Python's slicing.
        const snippet = Array.from(text).slice(0, 200).join("").trim();
        corrections.push({ text: snippet, line: lineNum, pattern });
        break; // One match per message is enough
      }
    }
  }

  return corrections;
}

// --- main -------------------------------------------------------------------

let hookInput: unknown;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  hookInput = {};
}

const transcriptPathRaw = pyGet(hookInput, "transcript_path", "");
if (!pyTruthy(transcriptPathRaw)) process.exit(0);
const transcriptPath = String(transcriptPathRaw);

const cwdRaw = pyGet(hookInput, "cwd", "");
const cwd = typeof cwdRaw === "string" ? cwdRaw : String(cwdRaw);
const pendingFile = getPendingFile(cwd);

// Scan for corrections
const corrections = scanTranscript(transcriptPath);

if (corrections.length < 2) {
  // Below threshold — clean up any stale pending file
  if (existsSync(pendingFile)) {
    try {
      unlinkSync(pendingFile);
    } catch {
      /* OSError: pass */
    }
  }
  process.exit(0);
}

// Write pending patterns for SessionStart to pick up
const pending = {
  session_transcript: transcriptPath,
  correction_count: corrections.length,
  samples: corrections.slice(0, 5), // Keep it small
  cwd: cwd,
};

try {
  mkdirSync(join(pendingFile, ".."), { recursive: true });
  writeFileSync(pendingFile, dumpIndent(pending));
  console.error(`[PatternScan] Found ${corrections.length} corrections, wrote ${pendingFile}`);
} catch (e) {
  console.error(`[PatternScan] Failed to write pending patterns: ${(e as Error).message}`);
}

process.exit(0);
