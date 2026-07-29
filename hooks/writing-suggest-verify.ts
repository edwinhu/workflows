#!/usr/bin/env bun
/**
 * PostToolUse hook: Suggest /writing-revise after N edits in writing workflow.
 *
 * Only fires for Edit/Write on .md files when an active writing workflow exists.
 * Tracks edit count in ACTIVE_WORKFLOW.md and suggests edit loop at threshold.
 *
 * Hooks read their payload from STDIN -- CLAUDE_TOOL_INPUT does not exist -- and
 * {"result": "continue"} is not part of the hook contract. This hook used both, so it
 * saw an empty file_path on EVERY Edit/Write, took the early-return branch, and then
 * emitted a payload the harness rejected outright ("Hook JSON output validation
 * failed"). Net effect: the verify-nudge never fired and the edit counter never moved.
 * Non-blocking feedback on PostToolUse is hookSpecificOutput.additionalContext;
 * printing nothing is how a hook says "carry on".
 *
 * PORT NOTES — where a "cleaner" TypeScript version silently diverges:
 *   1. `.endsWith('.md')`, never `.includes('.md')`. `notes.markdown` contains the substring and
 *      would move the counter on a file the Python ignores.
 *   2. A non-numeric `edits_since_verify:` must CRASH (exit 1, empty stdout, state file
 *      UNTOUCHED). Python's `int('many')` raises ValueError and nothing catches it. Defensively
 *      coercing to 0 would rewrite the user's state file on malformed input.
 *   3. update_yaml_value has THREE arms, not two: substitute; else insert before the first line
 *      whose strip() == '---' at index > 0 (the `i > 0` guard deliberately skips the OPENING
 *      delimiter); else append at end. Collapsing the last two writes the pair in the wrong place.
 *   4. `context()` (i.e. pyJson), never JSON.stringify — the 📝 must serialize as 📝.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { context } from "./_gate_common.ts";

/** Python `int(text)`: optional sign, decimal digits (underscore separators allowed). */
function pyInt(text: string): number {
  if (!/^[+-]?[0-9]+(_[0-9]+)*$/.test(text)) {
    throw new Error(`ValueError: invalid literal for int() with base 10: '${text}'`);
  }
  return Number(text.replace(/_/g, ""));
}

/** Python's str.strip(chars): remove every leading/trailing char in the set. */
function stripChars(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s[start])) start++;
  while (end > start && chars.includes(s[end - 1])) end--;
  return s.slice(start, end);
}

/** Extract a single value from YAML-like content. */
function parseYamlValue(content: string, key: string): string | null;
function parseYamlValue(content: string, key: string, def: string): string;
function parseYamlValue(content: string, key: string, def: string | null = null): string | null {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(content);
  if (match) {
    // Python: .strip().strip('"').strip("'") — the quote strips run on the whitespace-stripped value.
    return stripChars(stripChars(match[1].trim(), '"'), "'");
  }
  return def;
}

/** Update a single value in YAML-like content. */
function updateYamlValue(content: string, key: string, newValue: string): string {
  let count = 0;
  const newContent = content.replace(new RegExp(`^(${key}:\\s*)(.+)$`, "gm"), (_m, g1: string) => {
    count++;
    return `${g1}${newValue}`;
  });
  if (count === 0) {
    // Key doesn't exist, add it after the opening ---
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---" && i > 0) {
        // Found the closing ---, insert before it
        lines.splice(i, 0, `${key}: ${newValue}`);
        return lines.join("\n");
      }
    }
    // No closing --- found, append to end
    return content + `\n${key}: ${newValue}`;
  }
  return newContent;
}

let hookInput: unknown;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

// Mirrors Python's `.get` on a non-dict payload: AttributeError -> exit 1, empty stdout, no write.
if (typeof hookInput !== "object" || hookInput === null || Array.isArray(hookInput)) {
  throw new Error(`AttributeError: '${typeof hookInput}' object has no attribute 'get'`);
}
const payload = hookInput as Record<string, unknown>;

const toolName = payload.tool_name ?? "";
if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
  process.exit(0);
}

const toolInput = (payload.tool_input as Record<string, unknown> | null) || {};
const filePath = toolInput.file_path ?? "";

// Only process markdown files
if (typeof filePath !== "string") {
  throw new Error(`AttributeError: '${typeof filePath}' object has no attribute 'endswith'`);
}
if (!filePath.endsWith(".md")) {
  process.exit(0);
}

// Check for active writing workflow
const workflowPath = join(process.cwd(), ".planning", "ACTIVE_WORKFLOW.md");
if (!existsSync(workflowPath)) {
  process.exit(0);
}

let content: string;
try {
  content = readFileSync(workflowPath, "utf8");
} catch {
  process.exit(0);
}

// Check if this is a writing workflow
const workflowType = parseYamlValue(content, "workflow");
if (workflowType !== "writing") {
  process.exit(0);
}

// Get current edit count and threshold
let edits = pyInt(parseYamlValue(content, "edits_since_verify", "0"));
const threshold = pyInt(parseYamlValue(content, "verify_threshold", "10"));

// Increment edit count
edits += 1;

if (edits >= threshold) {
  // Reset counter and suggest verification
  writeFileSync(workflowPath, updateYamlValue(content, "edits_since_verify", "0"));

  // style/phase are read from the ORIGINAL content, before the rewrite.
  const style = parseYamlValue(content, "style", "general");
  const phase = parseYamlValue(content, "phase", "edit");

  context(
    "PostToolUse",
    `📝 ${edits} edits since last verify (style: ${style}, phase: ${phase}). ` +
      "Consider `/writing-revise` to apply fixes and polish.",
  );
} else {
  // Just increment counter
  writeFileSync(workflowPath, updateYamlValue(content, "edits_since_verify", String(edits)));
  process.exit(0);
}
