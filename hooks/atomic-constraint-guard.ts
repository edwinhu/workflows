#!/usr/bin/env bun
/** PostToolUse hook: Guard against monolithic constraint files.
 *
 * Fires on Write/Edit. Detects two anti-patterns:
 * 1. Writing a .md file to references/ (not constraints/) that looks like bundled constraints
 * 2. Writing a .md file to references/constraints/ with 3+ ### rule headings (monolith)
 *
 * Non-blocking: reports as additional context so the agent can self-correct.
 *
 * Port note: the original counts headings with `re.findall(r"^###\s+", content, re.MULTILINE)`.
 * Python's `\s` is [ \t\n\r\f\v] and MULTILINE `^` matches only at start-of-string or after "\n" —
 * JS's `\s` and `m` flag are both wider (unicode spaces, \r and   as line starts). The count
 * below reproduces Python's semantics exactly rather than using /^###\s+/gm.
 */
import { allow, context, readPayload } from "./_gate_common.ts";

let hookInput: Record<string, unknown>;
try {
  hookInput = await readPayload();
} catch {
  allow();
}

const toolName = String(hookInput!.tool_name ?? "");
const toolInput = (hookInput!.tool_input as Record<string, unknown>) ?? {};

if (toolName !== "Edit" && toolName !== "Write") allow();

const filePath = (toolInput.file_path ?? "") as string;
if (!filePath) allow();

// Python pathlib: parts / name / stem / suffix.
const parts = String(filePath)
  .split("/")
  .filter((p) => p !== "" && p !== ".");
const name = parts.length ? parts[parts.length - 1] : "";
const dot = name.lastIndexOf(".");
const suffix = dot > 0 ? name.slice(dot) : "";
const stem = suffix ? name.slice(0, -suffix.length) : name;

if (suffix.toLowerCase() !== ".md") allow();

if (!parts.includes("references")) allow();

let content: string;
try {
  content = await Bun.file(String(filePath)).text();
} catch {
  allow();
}

/** len(re.findall(r"^###\s+", content, re.MULTILINE)) — Python semantics. */
function countH3(text: string): number {
  const re = /###[ \t\n\r\f\v]+/g;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index!;
    if (i === 0 || text[i - 1] === "\n") n++;
  }
  return n;
}

const messages: string[] = [];

const refIdx = parts.lastIndexOf("references");
const inConstraintsDir = refIdx + 1 < parts.length && parts[refIdx + 1] === "constraints";

if (!inConstraintsDir) {
  const h3Count = countH3(content!);
  if ((stem.endsWith("-constraints") || stem.endsWith("-conventions")) && h3Count >= 3) {
    messages.push(
      `MONOLITH DETECTED: ${name} has ${h3Count} sections and looks like bundled constraints. ` +
        `Split into individual .md files in references/constraints/ — one rule per file. ` +
        `See the atomic-constraints constraint for details.`,
    );
  }
}

if (inConstraintsDir) {
  const h3Count = countH3(content!);
  // Allow the meta-constraint itself to have structure
  if (h3Count >= 3 && stem !== "atomic-constraints") {
    messages.push(
      `POTENTIAL MONOLITH: ${name} has ${h3Count} ### headings. ` +
        `Each constraint file should contain ONE rule. ` +
        `If these headings describe different rules, split into separate files.`,
    );
  }
}

if (!messages.length) allow();

context("PostToolUse", messages.join("\n"));
