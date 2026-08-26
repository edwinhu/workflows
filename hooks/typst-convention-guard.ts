#!/usr/bin/env bun
/**
 * PostToolUse hook: Check Typst conventions after Edit/Write on .typ files.
 *
 * Fires after Edit or Write tool calls that modify .typ files.
 * Runs quick grep-based checks and reports violations as additional context.
 *
 * Non-blocking: reports violations so the agent can fix them immediately.
 *
 * PORT NOTES — the odd bits are deliberate, not bugs to fix:
 *   - Check 9 interpolates a Python float, so "1" renders as "1.0em", not "1em".
 *   - The apostrophe message contains the LITERAL text `\u{2019}` — it is not an escape.
 *   - Only `json.load(sys.stdin)` is guarded in the original; a payload that parses but is not a
 *     dict dies on `.get(...)` with an AttributeError (exit 1, empty stdout). Preserved.
 */
import { existsSync, readFileSync } from "node:fs";
import { pyJson } from "./_gate_common.ts";
import { isTypDeck } from "./writing-prose-check.ts";

/** Python's Path(...) normalization, enough for suffix/stem: strip trailing slashes, take the name. */
function pathName(p: string): string {
  let s = p;
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  const idx = s.lastIndexOf("/");
  return idx < 0 ? s : s.slice(idx + 1);
}

/** Python's PurePath.suffix. */
function pathSuffix(p: string): string {
  const name = pathName(p);
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

/** Python's PurePath.stem. */

/** Python's str.splitlines (the boundaries that matter for text files). */
function splitLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Python's str.rstrip() — trailing whitespace only. */
function rstrip(s: string): string {
  return s.replace(/\s+$/, "");
}

/** Python's f-string rendering of a float: 1 -> "1.0", 1.5 -> "1.5". */
function pyFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** Run convention checks on a .typ file. Returns list of violation messages. */
function checkFile(filepath: string): string[] {
  if (!existsSync(filepath) || pathSuffix(filepath) !== ".typ") return [];

  let content: string;
  try {
    content = readFileSync(filepath, "utf8");
  } catch {
    return [];
  }

  const lines = splitLines(content);
  const violations: string[] = [];

  // Check 1: Missing blank lines between top-level bullets
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length) {
      const curr = rstrip(lines[i]);
      const nxt = rstrip(lines[i + 1]);
      // Two consecutive lines starting with "- " (top-level bullets)
      if (/^\s{0,1}-\s/.test(curr) && /^\s{0,1}-\s/.test(nxt)) {
        violations.push(`Line ${i + 1}: Missing blank line between top-level bullets`);
      }
    }
  }

  // Check 2: Fake sub-bullets using -- as marker
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+--\s/.test(lines[i])) {
      violations.push(
        `Line ${i + 1}: Fake sub-bullet using '--'. Use two-space indent + '- ' instead`,
      );
    }
  }

  // Check 3: cetz-plot import (banned)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("cetz-plot")) {
      violations.push(`Line ${i + 1}: cetz-plot import detected. Use #table() instead`);
    }
  }

  // Check 4: Missing qr: none in config-info (decks only).
  // NOT `pathStem(filepath).includes("slides")` — the filename with its extension stripped, which
  // matched only a file literally named `slides.typ` and skipped every deck stored as
  // `slides/<name>.typ`. Same defect as overflow-check.ts had; `isTypDeck` is the shared predicate.
  if (isTypDeck(filepath)) {
    if (content.includes("config-info") && !content.includes("qr:")) {
      violations.push("Missing 'qr: none' in config-info block");
    }
  }

  // Check 5: Uncentered images
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("#image(") && !lines[i].includes("align(center)")) {
      // Check if previous line has align(center)
      if (i === 0 || !lines[i - 1].includes("align(center)")) {
        violations.push(`Line ${i + 1}: #image() not wrapped in #align(center)`);
      }
    }
  }

  // Check 6: Smart apostrophe issues
  for (let i = 0; i < lines.length; i++) {
    if (/[)\]]'s/.test(lines[i])) {
      violations.push(
        `Line ${i + 1}: Smart apostrophe issue. Use \\u{2019}s instead of )'s or ]'s`,
      );
    }
  }

  // Check 7: Unescaped dollar signs before numbers
  for (let i = 0; i < lines.length; i++) {
    if (/[^\\]\$\d/.test(lines[i])) {
      violations.push(`Line ${i + 1}: Unescaped dollar sign. Use \\$ instead of $`);
    }
  }

  // Check 8: Table inset too small
  for (let i = 0; i < lines.length; i++) {
    const insetMatch = lines[i].match(/inset:\s*(\d+)pt/);
    if (insetMatch && parseInt(insetMatch[1], 10) < 10) {
      violations.push(
        `Line ${i + 1}: Table inset ${insetMatch[1]}pt is too small. Use 10pt minimum`,
      );
    }
  }

  // Check 9: cetz canvas without minimum length
  for (let i = 0; i < lines.length; i++) {
    const lengthMatch = lines[i].match(/length:\s*(\d+(?:\.\d+)?)(cm|mm|pt|em)/);
    if (lengthMatch && content.includes("cetz")) {
      const val = parseFloat(lengthMatch[1]);
      const unit = lengthMatch[2];
      if (unit === "em" && val < 2) {
        violations.push(
          `Line ${i + 1}: CeTZ canvas length ${pyFloat(val)}${unit} is too small. Use 2em minimum`,
        );
      } else if (unit === "cm" || unit === "mm") {
        violations.push(`Line ${i + 1}: CeTZ canvas uses ${unit}. Use em units (minimum 2em)`);
      }
    }
  }

  // Limit to first 5 violations to avoid overwhelming output
  return violations.slice(0, 5);
}

function main(hookInput: Record<string, unknown>): never {
  // Mirrors Python's AttributeError on a non-dict payload: crash, exit 1, empty stdout.
  if (hookInput === null || typeof hookInput !== "object" || Array.isArray(hookInput)) {
    throw new TypeError("hook_input has no attribute 'get'");
  }

  const toolName = "tool_name" in hookInput ? hookInput.tool_name : "";
  const toolInput = "tool_input" in hookInput ? hookInput.tool_input : {};

  if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    throw new TypeError("tool_input has no attribute 'get'");
  }
  const ti = toolInput as Record<string, unknown>;
  const filePathRaw = "file_path" in ti ? ti.file_path : "";
  if (typeof filePathRaw !== "string") {
    throw new TypeError("file_path has no attribute 'endswith'");
  }
  if (!filePathRaw.endsWith(".typ")) process.exit(0);

  const violations = checkFile(filePathRaw);
  if (violations.length > 0) {
    let msg = "TYPST CONVENTION VIOLATIONS detected:\n";
    for (const v of violations) msg += `  - ${v}\n`;
    msg += "\nFix these before proceeding. Every convention violation is rework for the presenter.";

    console.log(
      pyJson({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: msg,
        },
      }),
    );
  }

  process.exit(0);
}

let payload: unknown;
try {
  payload = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}
main(payload as Record<string, unknown>);
