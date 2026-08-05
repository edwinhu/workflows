#!/usr/bin/env bun
/**
 * PostToolUse hook: the deterministic prose audit + structural constraints after draft edits.
 *
 * Fires on Edit|Write to:
 *   - `drafts/*.md`   — markdown drafts (existing gate), AND
 *   - `*.typ` LETTERS — Typst letters (NOT slide decks; decks are skipped).
 *
 * ONE PROSE ENGINE, ONE STRUCTURAL ENGINE:
 *   1. scripts/prose-audit.py — every prose/AI-tell pattern system, de-duplicated, span-id'd.
 *   2. references/constraints/check-all.py — STRUCTURAL constraints only (bold-lead,
 *      topic-sentences, anchored-numbers, outline-sync): real logic, not regex over prose.
 *
 * WHY THAT SPLIT IS NOW A PREFIX RULE AND NOT A NAMED SET. This hook used to run prose-lint AND
 * check-all and suppress the overlap with `PROSE_LINT_SUPERSEDES`, a hand-maintained set of three
 * constraint names. It named the wrong three: the wikipedia-* tables are in BOTH engines and were
 * in neither's supersede list, so every AI-tell inside an edited range was reported to the model
 * twice. The set is gone. check-all's prose modules are skipped by the directory they live in,
 * which cannot fall out of date as tables are added. See
 * docs/DESIGN-prose-constraint-architecture.md.
 *
 * Neither engine is reimplemented here: both are the same Python scripts, spawned from the same
 * PLUGIN_ROOT-relative paths, so their exact strings and regex tables stay the source of truth.
 * Footnote masking, stylometrics and range-independent document signals now live inside
 * prose-audit.py rather than being assembled here.
 *
 * Non-blocking: reports violations as an additionalContext message.
 */
import { context, readPayload } from "./_gate_common";
import { existsSync, readFileSync } from "node:fs";
import { authenticatedWritingPlan } from "./lib/writing-plan-context.ts";
import { join, dirname } from "node:path";

const PLUGIN_ROOT = dirname(import.meta.dir);
const CHECK_ALL = join(PLUGIN_ROOT, "references", "constraints", "check-all.py");
const PROSE_AUDIT = join(PLUGIN_ROOT, "scripts", "prose-audit.py");

// Both scripts declare their own dependencies in a `uv run --with …` shebang; spawning them
// through the interpreter bypasses the shebang, so the deps are named here instead. Without
// lxml the .docx and wikipedia-* paths die at import; without pyyaml the diction tier does.
const PY = ["uv", "run", "--with", "lxml", "--with", "pyyaml", "python3"];

/** check-all constraint families that prose-audit.py already owns. A check-all entry name is
 *  `constraints/<stem>` or `skills/<skill>/references/<stem>`, so a directory prefix is enough. */
/*  `constraints/writing-no-bold-lead` is named explicitly rather than by directory: it is the one
 *  entry under `constraints/` that now DELEGATES to prose-audit.py (as `emphasis·bold-lead`), so
 *  leaving it in would report the same span from both engines — the exact double-reporting the
 *  prefix rule below exists to end. Its siblings under `constraints/` are structural and stay. */
const PROSE_ENGINE_PREFIXES = [
  "skills/ai-anti-patterns/",
  "skills/writing-",
  "constraints/writing-no-bold-lead",
];

const _DECK_MARKERS = ["touying", "polylux", "#slide("];
const _DECK_DIR_RE = /^(slides|presentation)/i;

// ---------------------------------------------------------------------------
// pathlib.Path semantics, only as far as this hook uses them.
// ---------------------------------------------------------------------------
function pyParts(p: string): string[] {
  const parts: string[] = [];
  if (p.startsWith("/")) parts.push("/");
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    parts.push(seg);
  }
  return parts;
}
function pyStr(p: string): string {
  const parts = pyParts(p);
  if (!parts.length) return ".";
  if (parts[0] === "/") return "/" + parts.slice(1).join("/");
  return parts.join("/");
}
function pyName(p: string): string {
  const parts = pyParts(p);
  const last = parts[parts.length - 1];
  return last === undefined || last === "/" ? "" : last;
}
function pyParent(p: string): string {
  const parts = pyParts(p);
  if (!parts.length) return ".";
  if (parts.length === 1) return parts[0] === "/" ? "/" : ".";
  const rest = parts.slice(0, -1);
  if (rest[0] === "/") return "/" + rest.slice(1).join("/");
  return rest.join("/");
}
function pySuffix(p: string): string {
  const name = pyName(p);
  if (name === "" || name === "." || name === "..") return "";
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// FOOTNOTE MASKING USED TO BE INLINED HERE, a hand port of scripts/lib/footnote_mask.py kept in
// sync by hand, because this hook fed style_metrics.py an on-disk draft directly. prose-audit.py
// masks all three formats itself (markdown, Typst, docx footnotes.xml) before any scorer sees the
// text, so the copy is gone rather than maintained in two languages.

type Range = [number, number];
const WHOLE_FILE: Range = [1, 10 ** 9];

function runPy(args: string[], cwd?: string): { stdout: string; ok: boolean } {
  try {
    const proc = Bun.spawnSync([...PY, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
    return { stdout: new TextDecoder().decode(proc.stdout), ok: true };
  } catch {
    return { stdout: "", ok: false };
  }
}

/** The plan's domain, normalized to prose-audit.py's `--style` vocabulary. Anything the audit
 *  does not know about degrades to `general` (Strunk + the AI-tell tables, no domain guide)
 *  rather than erroring out and leaving the draft unlinted. */
export function auditStyle(style: string | null): string {
  const s = (style || "").toLowerCase();
  return s === "legal" || s === "econ" ? s : "general";
}

export function isTypDeck(path: string): boolean {
  const parts = pyParts(path);
  for (const part of parts.slice(0, -1)) {
    if (_DECK_DIR_RE.test(part)) return true;
  }
  let text: string;
  try {
    text = readFileSync(path).toString("utf8"); // errors="ignore"-ish
  } catch {
    return false;
  }
  return _DECK_MARKERS.some((marker) => text.includes(marker));
}

export function editRanges(toolName: string, toolInput: Record<string, unknown>, path: string): Range[] {
  if (toolName === "Write") return [WHOLE_FILE];
  const newString = (toolInput.new_string as string) ?? "";
  const ranges: Range[] = [];
  if (newString && existsSync(path)) {
    let fileText = "";
    try {
      fileText = readFileSync(path, "utf8");
    } catch {
      fileText = "";
    }
    let idx = fileText.indexOf(newString);
    while (idx !== -1) {
      const startLine = countNewlines(fileText, 0, idx) + 1;
      const endLine = startLine + countNewlines(newString, 0, newString.length);
      ranges.push([Math.max(1, startLine - 2), endLine + 2]);
      idx = fileText.indexOf(newString, idx + 1);
    }
  }
  return ranges.length ? ranges : [WHOLE_FILE];
}

function countNewlines(s: string, start: number, end: number): number {
  let c = 0;
  for (let i = start; i < end; i++) if (s[i] === "\n") c++;
  return c;
}

export function inRanges(lineNo: number, ranges: Range[]): boolean {
  return ranges.some(([a, b]) => a <= lineNo && lineNo <= b);
}

/** THE prose engine. One span per violation, already collapsed across every pattern system, so
 *  what reaches the model is one line per finding rather than the same phrase under three labels. */
export function runProseAudit(path: string, style: string | null, ranges: Range[]): string[] {
  const { stdout, ok } = runPy([PROSE_AUDIT, "--json", "--style", auditStyle(style), path]);
  if (!ok) return [];
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(stdout);
  } catch {
    return [];
  }
  const spans = (result.spans as Record<string, unknown>[]) ?? [];
  // A span at line 0 is document-level (diction saturation, per-section em-dash budget). It is
  // real, but it does not belong to any edited line, so it is only reported on a whole-file Write
  // — attaching it to an arbitrary Edit would repeat it on every subsequent keystroke.
  const wholeFile = ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] >= 10 ** 9;
  const out: string[] = [];
  for (const span of spans) {
    const line = Number(span.line ?? 0);
    if (line === 0 ? !wholeFile : !inRanges(line, ranges)) continue;
    // A span's labels carry their own `<system>: ` prefix so a reviewer citing a span id can tell
    // which table produced which label. In a one-line hook message the system is already the
    // bracket, so the prefix is stripped back off rather than printed twice.
    const labels = ((span.labels as string[]) ?? [])
      .map((l) => l.replace(/^[a-z0-9-]+: /, ""))
      .join(" | ");
    const where = line === 0 ? "doc" : String(line);
    const severity = String(span.severity ?? "soft");
    out.push(`${pyName(path)}:${where} [${span.system}${severity === "hard" ? "/HARD" : ""}] ${labels}`);
  }
  return out;
}

export function runCheckAll(projectRoot: string, path: string, ranges: Range[]): string[] {
  let results: Record<string, unknown> = {};
  try {
    const { stdout } = runPy([CHECK_ALL, projectRoot]);
    // Python iterates code POINTS and slices by them; mirror that so an astral char
    // ahead of the JSON blob cannot shift the cut.
    const raw = Array.from(stdout.trim());
    let braceDepth = 0;
    let jsonEnd = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === "{") braceDepth += 1;
      else if (ch === "}") {
        braceDepth -= 1;
        if (braceDepth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
    results = jsonEnd ? JSON.parse(raw.slice(0, jsonEnd).join("")) : {};
  } catch {
    return [];
  }

  const lineRe = new RegExp(`drafts/${reEscape(pyName(path))}:(\\d+):`);
  const out: string[] = [];
  for (const entry of (results.failed as Record<string, unknown>[]) ?? []) {
    const name = (entry.name as string) ?? "";
    // Prose is prose-audit.py's job; check-all contributes only its structural constraints.
    if (PROSE_ENGINE_PREFIXES.some((p) => name.startsWith(p))) continue;
    for (const v of (entry.violations as string[]) ?? []) {
      const m = lineRe.exec(v);
      if (m && inRanges(parseInt(m[1], 10), ranges)) out.push(v);
    }
  }
  return out;
}

async function main(): Promise<void> {
  let hookInput: Record<string, unknown>;
  try {
    hookInput = await readPayload();
  } catch {
    process.exit(0);
  }

  const toolName = (hookInput.tool_name as string) ?? "";
  if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

  const toolInput = (hookInput.tool_input as Record<string, unknown>) ?? {};
  const filePath = (toolInput.file_path as string) ?? "";
  if (!filePath) process.exit(0);

  const path = pyStr(filePath);
  const suffix = pySuffix(path).toLowerCase();

  let projectRoot: string;
  let runCheckAllFlag: boolean;
  if (suffix === ".md") {
    if (pyName(pyParent(path)) !== "drafts") process.exit(0);
    projectRoot = pyParent(pyParent(path));
    runCheckAllFlag = true;
  } else if (suffix === ".typ") {
    if (isTypDeck(path)) process.exit(0);
    projectRoot = pyParent(path);
    runCheckAllFlag = false; // check-all only scans drafts/*.md
  } else {
    process.exit(0);
  }

  const writingPlan = authenticatedWritingPlan(projectRoot);
  // Canonical writing hooks run only for an authenticated APPROVED receipt-selected plan.
  // Missing, pending, malformed, and legacy-only projects fail safe without lint output.
  if (!writingPlan) process.exit(0);
  const style = writingPlan.style || null;
  const ranges = editRanges(toolName, toolInput, path);

  let violations = runProseAudit(path, style, ranges);
  if (runCheckAllFlag) violations = violations.concat(runCheckAll(projectRoot, path, ranges));
  // Belt and braces on the de-duplication invariant: the audit collapses overlapping spans, and
  // check-all no longer contributes prose at all, so an identical line reaching here twice would
  // be a wiring regression. Report it once regardless.
  violations = [...new Set(violations)];

  if (!violations.length) process.exit(0);

  const output =
    "Prose quality violations (scoped to edited lines):\n" + violations.map((v) => `  • ${v}`).join("\n");
  context("PostToolUse", output);
}

// GUARDED SO THE MODULE CAN BE IMPORTED. Unguarded, `await main()` ran on import — reading stdin
// and exiting — so a test importing these helpers died before its first assertion and printed
// nothing, which reads as a pass. A hook has to be loadable to be unit-testable.
if (import.meta.main) await main();
