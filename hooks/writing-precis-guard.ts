#!/usr/bin/env bun
/**
 * PostToolUse hook: Verify PRECIS.md has required sections after Write.
 *
 * Fires after Write to .planning/PRECIS.md. Checks that all required sections
 * (Thesis, Key Claims with CLAIM-XX IDs, Audience, Scope) are present.
 *
 * Hooks receive their payload as JSON on STDIN -- there is no CLAUDE_TOOL_INPUT env
 * var, and there is no {"result": "continue"} in the hook contract. Non-blocking feedback on
 * PostToolUse goes through hookSpecificOutput.additionalContext; saying nothing is how a hook
 * says "carry on".
 */
import { existsSync, readFileSync } from "node:fs";
import { context, readPayload } from "./_gate_common.ts";

// Order matters: the missing-section list is emitted in this order (thesis, claims, audience),
// matching the Python dict's insertion order.
const REQUIRED_SECTIONS: Array<[string, RegExp]> = [
  ["thesis", /(?:^|\n)#+[\s]*thesis|(?:^|\n)\*\*thesis/i],
  ["claims", /CLAIM-\d+/],
  ["audience", /(?:^|\n)#+[\s]*audience|(?:^|\n)\*\*audience/i],
];

/** Emulate str(pathlib.Path(p)): collapse duplicate slashes and drop "." components. */
function pathStr(p: string): string {
  if (p === "") return ".";
  const absolute = p.startsWith("/");
  const parts = p.split("/").filter((x) => x !== "" && x !== ".");
  const joined = parts.join("/");
  if (absolute) return "/" + joined;
  return joined === "" ? "." : joined;
}

function pathName(p: string): string {
  const s = pathStr(p);
  const parts = s.split("/");
  const last = parts[parts.length - 1];
  return last === "." || last === ".." || last === "" ? "" : last;
}

let hookInput: Record<string, unknown>;
try {
  hookInput = await readPayload();
} catch {
  process.exit(0);
}

const toolName = String(hookInput.tool_name ?? "");
if (!["Write", "Edit", "MultiEdit"].includes(toolName)) process.exit(0);

const toolInput = (hookInput.tool_input as Record<string, unknown>) ?? {};
const filePath = String(toolInput.file_path ?? "");
if (!filePath) process.exit(0);

// Only check PRECIS.md writes
if (pathName(filePath) !== "PRECIS.md" || !pathStr(filePath).includes(".planning")) {
  process.exit(0);
}

if (!existsSync(filePath)) process.exit(0);

let content: string;
try {
  content = readFileSync(filePath, "utf8");
} catch {
  process.exit(0);
}

const missing: string[] = [];
for (const [section, pattern] of REQUIRED_SECTIONS) {
  if (!pattern.test(content)) missing.push(section);
}

if (missing.length) {
  context(
    "PostToolUse",
    `PRECIS.md is missing required sections: ${missing.join(", ")}\n` +
      `A complete PRECIS needs: Thesis (main argument), ` +
      `Key Claims (with CLAIM-XX IDs), and Audience.\n` +
      `Add the missing sections before proceeding to outline.`,
  );
}
process.exit(0);
