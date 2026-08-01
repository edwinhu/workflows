#!/usr/bin/env bun
/**
 * PreToolUse hook: Block writing prose to drafts/ without a matching outline in outlines/.
 *
 * Scoped to the writing-draft skill. The hard stop is `permissionDecision: "deny"` — on PreToolUse
 * only that (or exit code 2) blocks; any other non-zero exit is a "non-blocking error" that lets the
 * Write through with the message never reaching Claude.
 *
 * PORT NOTES — the odd bits are deliberate, do not "fix" them:
 *   - Only `json.load(sys.stdin)` is wrapped in try/except. A payload that PARSES but is not a dict
 *     dies on `.get(...)` with an AttributeError: exit 1, empty stdout. Reproduced by throwing.
 *   - `stem.replace(' (Draft)', '')` is Python str.replace — it replaces EVERY occurrence, not just
 *     a suffix, and it is applied to the stem (name minus final suffix), not the whole name.
 *   - The outline match is case-INSENSITIVE on both sides (`outlines/introduction.md` satisfies a
 *     draft named `Introduction (Draft).md`). A `===` port passes the deny cases and silently
 *     over-blocks the real one.
 *   - `outlines_dir` is interpolated into the deny text as `str(Path(...))`, so `drafts_idx == 0`
 *     yields the bare `outlines` (Path('.') / 'outlines'), not `./outlines`.
 */
import { existsSync, readdirSync } from "node:fs";
import { deny, denyOnCrash } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("WRITING OUTLINE GUARD");

/** pathlib.PurePosixPath(p).parts — absolute paths carry a leading "/" element. */
function pathParts(p: string): string[] {
  const parts: string[] = [];
  if (p.startsWith("/")) parts.push("/");
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    parts.push(seg);
  }
  return parts;
}

/** str(Path(*parts)) for the parts produced above. */
function joinParts(parts: string[]): string {
  if (!parts.length) return ".";
  if (parts[0] === "/") return "/" + parts.slice(1).join("/");
  return parts.join("/");
}

/** Python's `Path(a) / b` rendered as a string (b is a plain relative name here). */
function pathJoin(a: string, b: string): string {
  if (a === ".") return b;
  if (a === "/") return "/" + b;
  return `${a}/${b}`;
}

/** Python's PurePath.stem. */
function pathStem(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx > 0 && idx < name.length - 1) return name.slice(0, idx);
  return name;
}

/** Python's str.strip() with no argument. */
function pyStrip(s: string): string {
  return s.replace(/^[\s\x1c-\x1f]+/, "").replace(/[\s\x1c-\x1f]+$/, "");
}

let hookInput: unknown;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

// Mirrors Python's AttributeError on a non-dict payload: crash, exit 1, empty stdout.
if (hookInput === null || typeof hookInput !== "object" || Array.isArray(hookInput)) {
  throw new TypeError("hook_input has no attribute 'get'");
}
const payload = hookInput as Record<string, unknown>;

const toolName = payload.tool_name ?? "";
const rawInput = payload.tool_input ?? {};
const toolInput =
  rawInput !== null && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};

if (toolName !== "Write") process.exit(0);

const rawFilePath = toolInput.file_path ?? "";
if (!rawFilePath) process.exit(0);
// Path(non-str) raises TypeError in Python — same crash contract as the non-dict payload above.
if (typeof rawFilePath !== "string") {
  throw new TypeError("argument should be a str or an os.PathLike object");
}
const filePath: string = rawFilePath;

// Check if writing to a drafts/ directory
const parts = pathParts(filePath);
const draftsIdx = parts.indexOf("drafts");
if (draftsIdx === -1) process.exit(0); // Not a drafts/ file, allow

// Extract the section name from the filename.
// Convention: drafts/[Section] (Draft).md or drafts/[Section].md
const stem = pathStem(parts.length ? parts[parts.length - 1] : "");
// Strip " (Draft)" suffix if present (str.replace: all occurrences)
const sectionName = pyStrip(stem.split(" (Draft)").join("").split(" (draft)").join(""));

if (!sectionName) process.exit(0); // Can't determine section, allow

// Look for a matching outline in outlines/ — a sibling of drafts/
const draftsParent = draftsIdx > 0 ? joinParts(parts.slice(0, draftsIdx)) : ".";
const outlinesDir = pathJoin(draftsParent, "outlines");

let outlineFound = false;
if (existsSync(outlinesDir)) {
  for (const entry of readdirSync(outlinesDir)) {
    const outlineStem = pyStrip(pathStem(entry));
    if (outlineStem.toLowerCase() === sectionName.toLowerCase()) {
      outlineFound = true;
      break;
    }
  }
}

if (outlineFound) process.exit(0); // Outline exists, allow

// Hard block — NO PROSE WITHOUT OUTLINE (Iron Law enforcement).
deny(
  `BLOCKED: No outline found for this draft.\n\n` +
    `Writing to \`${filePath}\` but no matching outline in \`${outlinesDir}/\`.\n` +
    `Expected: \`${outlinesDir}/${sectionName}.md\`\n\n` +
    `Create the outline first. Prose without structure produces wandering drafts ` +
    `that require full rewrites — that's anti-helpful, not efficient.`,
);
