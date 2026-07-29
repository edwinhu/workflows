#!/usr/bin/env bun
/**
 * PostToolUse hook: enforce CLAIM-XX traceability on written outline/draft files.
 *
 * Claims must be traceable through every artifact so the deterministic section index
 * (scripts/writing/writing_section_index.py) can resolve each section's claims and run the ⊇
 * gate (draft.implements ⊇ the OUTLINE.md Claim→Section Map's primary claims).
 *
 * Enforcement is SCOPED to avoid false positives on incremental work (the in-flight-project
 * risk flagged in DESIGN D-w-3):
 *   - drafts/  → BLOCK on zero CLAIM-XX. A finished prose draft with no claim trace cannot be
 *     indexed and would fail the ⊇ gate anyway; drafts are not built point-by-point.
 *   - outlines/ → WARN only. Outlines are written subsection-by-subsection; the COMPREHENSIVE
 *     hard gate is hooks/writing-outline-executable-guard.py (PreToolUse on OUTLINE_REVIEWED.md).
 * Only enforced inside a writing PROJECT (a .planning/ dir present).
 *
 * Hooks read their payload from STDIN -- CLAUDE_TOOL_INPUT does not exist -- and there is no
 * {"result": ...} field in the hook contract. Warnings go through
 * hookSpecificOutput.additionalContext; a hard stop on PostToolUse is top-level
 * decision:"block" + reason (NOT the PreToolUse deny() shape).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { context, pyJson, readPayload } from "./_gate_common.ts";

const CLAIM_PATTERN = /CLAIM-\d+/g;

/** Emulate pathlib.PurePath(p).parts. */
function pathParts(p: string): string[] {
  const absolute = p.startsWith("/");
  const segs = p.split("/").filter((x) => x !== "" && x !== ".");
  return absolute ? ["/", ...segs] : segs;
}

/** Emulate pathlib.PurePath(p).parents (nearest ancestor first). */
function pathParents(p: string): string[] {
  const parts = pathParts(p);
  const absolute = parts[0] === "/";
  const build = (n: number): string => {
    if (absolute) return n <= 1 ? "/" : "/" + parts.slice(1, n).join("/");
    return n === 0 ? "." : parts.slice(0, n).join("/");
  };
  const out: string[] = [];
  const floor = absolute ? 1 : 0;
  for (let n = parts.length - 1; n >= floor; n--) out.push(build(n));
  return out;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function inWritingProject(p: string): boolean {
  return pathParents(p).some((parent) => isDir(parent === "/" ? "/.planning" : `${parent}/.planning`));
}

let hookInput: Record<string, unknown>;
try {
  hookInput = await readPayload();
} catch {
  process.exit(0);
}

if (!["Write", "Edit", "MultiEdit"].includes(String(hookInput.tool_name ?? ""))) process.exit(0);

const toolInput = (hookInput.tool_input as Record<string, unknown>) ?? {};
const filePath = String(toolInput.file_path ?? "");
if (!filePath) process.exit(0);

const parts = pathParts(filePath);

// Only check outlines/ and drafts/ directories
const isOutline = parts.includes("outlines");
const isDraft = parts.includes("drafts");

if (!(isOutline || isDraft)) process.exit(0);

// Check if the file exists and contains CLAIM-XX references
if (!existsSync(filePath)) process.exit(0);

let content: string;
try {
  content = readFileSync(filePath, "utf8");
} catch {
  process.exit(0);
}

const claims = content.match(CLAIM_PATTERN) ?? [];
const artifactType = isOutline ? "outline" : "draft";

if (claims.length) process.exit(0);

const remedy =
  `No CLAIM-XX IDs found in ${artifactType} file: ${filePath}\n` +
  `Every ${artifactType} must reference the PRECIS claims it covers.\n` +
  `Add 'implements: [CLAIM-XX]' frontmatter (or a 'Claim Supported: CLAIM-XX' line).`;

// A finished DRAFT with no claim trace is unambiguous → BLOCK (only inside a project).
if (isDraft && inWritingProject(filePath)) {
  console.log(
    pyJson({
      decision: "block",
      reason:
        remedy +
        "\n\nThis draft cannot be indexed (its implements set is empty), so it would " +
        "fail the section-index ⊇ gate (draft.implements must ⊇ the OUTLINE.md " +
        "Claim → Section Map's primary claims for this section). Add the implements " +
        "frontmatter, then continue.",
    }),
  );
  process.exit(0);
}

// Outlines (or non-project files) → warn only; the outline-executable guard hard-gates at approval.
context("PostToolUse", remedy);
