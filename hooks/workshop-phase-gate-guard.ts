#!/usr/bin/env bun
/**
 * PreToolUse hook (workshop): phase-aware gate enforcer for slide/notes generation.
 *
 * Complements the generic phase-gate-guard (which gates ALL Edit/Write on the
 * Phase-1 SOURCES_VERIFIED artifact). This guard adds the Phase-2 -> Phase-3 gate
 * structurally: writing the *content* files (slides.typ / notes.typ) is blocked
 * until the outline has been approved.
 *
 *   Phase 2 -> 3 gate: writing slides.typ or notes.typ requires
 *     .planning/OUTLINE_APPROVED.md with status: APPROVED.
 *
 *   Phase 3 -> 4 gate: writing .planning/VALIDATION.md (the Phase 4 deliverable)
 *     requires .planning/SLIDES_REVIEWED.md with status: APPROVED — i.e. the
 *     workshop-verify artifact-review gate must have passed before the final
 *     verification record can be written.
 *
 * Path-scoped (only .typ content files and the VALIDATION.md deliverable trigger
 * it), so it composes with the SOURCES_VERIFIED hook without conflict. Other
 * writes to .planning/ and .claude/ are always allowed (each phase still needs to
 * write its own state + gate artifacts).
 *
 * ORDERING (load-bearing): the VALIDATION.md check runs BEFORE the .planning/.claude
 * always-allowed carve-out, so the deliverable itself is gated even though it lives
 * there. Reordering silently turns a deny into an allow.
 */
import { statSync, readFileSync } from "node:fs";
import { allow, deny } from "./_gate_common.ts";

const GATE_ARTIFACT = ".planning/OUTLINE_APPROVED.md";
const GATE_STATUS = "APPROVED";
const CONTENT_FILES = new Set(["slides.typ", "notes.typ"]);
const ALWAYS_ALLOWED_DIRS = new Set([".planning", ".claude"]);

const PHASE4_DELIVERABLE = "VALIDATION.md";
const PHASE4_GATE_ARTIFACT = ".planning/SLIDES_REVIEWED.md";
const PHASE4_GATE_STATUS = "APPROVED";

/** Mimic pathlib.PurePath(...).parts for POSIX paths. */
function pathParts(p: string): string[] {
  if (!p) return [];
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  return p.startsWith("/") ? ["/", ...segs] : segs;
}

/** Mimic pathlib.PurePath(...).name. */
function pathName(p: string): string {
  const parts = pathParts(p);
  if (!parts.length) return "";
  const last = parts[parts.length - 1];
  return last === "/" ? "" : last;
}

/** Python str.split(sep, maxsplit). */
function splitN(s: string, sep: string, maxsplit: number): string[] {
  const out: string[] = [];
  let rest = s;
  for (let i = 0; i < maxsplit; i++) {
    const idx = rest.indexOf(sep);
    if (idx === -1) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + sep.length);
  }
  out.push(rest);
  return out;
}

/** Python str.strip(chars) for a single char set. */
function stripChars(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s[start])) start++;
  while (end > start && chars.includes(s[end - 1])) end--;
  return s.slice(start, end);
}

/** Python str.strip() — whitespace. */
function pyStrip(s: string): string {
  return s.replace(/^[\s]+|[\s]+$/g, "");
}

function statusOk(path: string, required: string): boolean {
  let text: string;
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false;
  }
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (!text.startsWith("---")) return false;
  const parts = splitN(text, "---", 2);
  if (parts.length < 3) return false;
  const LINE_BOUNDARIES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
  for (let line of pyStrip(parts[1]).split(LINE_BOUNDARIES)) {
    line = pyStrip(line);
    if (line.startsWith("status:")) {
      const value = stripChars(stripChars(pyStrip(splitN(line, ":", 1)[1]), '"'), "'");
      return value.toUpperCase() === required.toUpperCase();
    }
  }
  return false;
}

function isContentFile(filePath: string): boolean {
  if (!filePath) return false;
  const parts = pathParts(filePath);
  for (const d of ALWAYS_ALLOWED_DIRS) {
    if (parts.includes(d)) return false;
  }
  return CONTENT_FILES.has(pathName(filePath));
}

function isWorkshopGenerateDispatch(toolInput: Record<string, unknown>): boolean {
  const target = `${toolInput.scriptPath ?? ""} ${toolInput.name ?? ""}`;
  return target.includes("workshop-generate");
}

let hookInput: Record<string, unknown>;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

const toolName = String(hookInput.tool_name ?? "");
const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;

if (toolName === "Workflow") {
  if (!isWorkshopGenerateDispatch(toolInput)) allow();
  if (!statusOk(GATE_ARTIFACT, GATE_STATUS)) {
    deny(
      `GATE BLOCKED: outline not approved.\n\n` +
        `Dispatching workshop-generate requires \`${GATE_ARTIFACT}\` with ` +
        `\`status: ${GATE_STATUS}\` — the Phase 2 outline-approval gate.\n\n` +
        `The artifact proves the user approved the outline before slide/notes ` +
        `generation. Instructional text alone is not enforcement.\n\n` +
        `**Remedy:** Return to Phase 2 (Structure Outline), get user approval, ` +
        `and write \`.planning/OUTLINE_APPROVED.md\`.`,
    );
  }
  allow();
}

if (toolName !== "Write" && toolName !== "Edit") allow();

const filePath = String(toolInput.file_path ?? "");

// Phase 3 -> 4 gate: the VALIDATION.md verification record requires a passed
// workshop-verify review gate. Checked before the always-allowed .planning
// carve-out so the deliverable itself is gated even though it lives there.
if (pathName(filePath) === PHASE4_DELIVERABLE) {
  if (!statusOk(PHASE4_GATE_ARTIFACT, PHASE4_GATE_STATUS)) {
    deny(
      `GATE BLOCKED: slides not reviewed.\n\n` +
        `Writing \`${PHASE4_DELIVERABLE}\` (the Phase 4 verification record) ` +
        `requires \`${PHASE4_GATE_ARTIFACT}\` with \`status: ${PHASE4_GATE_STATUS}\` ` +
        `— the Phase 3 artifact-review gate.\n\n` +
        `The artifact proves the workshop-verify workflow returned ` +
        `overallPass=true before final verification. Instructional text ` +
        `alone is not enforcement.\n\n` +
        `**Remedy:** Return to Phase 3, run the workshop-verify review gate ` +
        `to overallPass=true, and write \`.planning/SLIDES_REVIEWED.md\`.`,
    );
  }
  allow();
}

if (!isContentFile(filePath)) allow();

if (!statusOk(GATE_ARTIFACT, GATE_STATUS)) {
  deny(
    `GATE BLOCKED: outline not approved.\n\n` +
      `Writing \`${pathName(filePath)}\` requires \`${GATE_ARTIFACT}\` with ` +
      `\`status: ${GATE_STATUS}\` — the Phase 2 outline-approval gate.\n\n` +
      `The artifact proves the user approved the outline before slide/notes ` +
      `generation. Instructional text alone is not enforcement.\n\n` +
      `**Remedy:** Return to Phase 2 (Structure Outline), get user approval, ` +
      `and write \`.planning/OUTLINE_APPROVED.md\`.`,
  );
}
allow();
