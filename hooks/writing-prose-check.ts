#!/usr/bin/env bun
/**
 * PostToolUse hook: prose-lint + structural constraints after draft edits.
 *
 * TypeScript port of writing-prose-check.py — behavior-preserving, including the odd bits.
 *
 * Fires on Edit|Write to:
 *   - `drafts/*.md`   — markdown drafts (existing gate), AND
 *   - `*.typ` LETTERS — Typst letters (NOT slide decks; decks are skipped).
 *
 * Two engines run, complementary and de-duplicated:
 *   1. scripts/prose-lint.py — the comprehensive PROSE PATTERN engine.
 *   2. references/constraints/check-all.py — the GRANULAR engine (real logic, not regex tables).
 * Plus skills/ai-anti-patterns/scripts/style_metrics.py --lint for line-level stylometry.
 *
 * The three engines are NOT reimplemented here: they are the same Python scripts, spawned from the
 * same PLUGIN_ROOT-relative paths, so their exact strings (and their regex tables) stay the source
 * of truth. Only the routing, masking, range-scoping and formatting are ported.
 *
 * Non-blocking: reports violations as an additionalContext message.
 */
import { context, readPayload } from "./_gate_common";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { authenticatedWritingPlan } from "./lib/writing-plan-context.ts";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const PLUGIN_ROOT = dirname(import.meta.dir);
const CHECK_ALL = join(PLUGIN_ROOT, "references", "constraints", "check-all.py");
const PROSE_LINT = join(PLUGIN_ROOT, "scripts", "prose-lint.py");
const STYLE_LINT = join(PLUGIN_ROOT, "skills", "ai-anti-patterns", "scripts", "style_metrics.py");

// The Python original spawns `sys.executable`; it is itself launched through
// `#!/usr/bin/env -S uv run python3`, so the equivalent interpreter here is `uv run python3`.
const PY = ["uv", "run", "python3"];

const PROSE_LINT_SUPERSEDES = new Set([
  "writing-ai-smell-artifacts",
  "writing-ai-smell-puffery",
  "writing-ai-smell-structure",
]);

const _STYLE_CATEGORY: Record<string, string> = {
  legal: "writing-legal",
  econ: "writing-econ",
};

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

/** Python str.splitlines()-ish for the outputs we parse (no \r-only lines expected). */
function splitLines(s: string): string[] {
  const out = s.split("\n");
  if (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

// ---------------------------------------------------------------------------
// footnote_mask.py, inlined (the Python hook imports it from scripts/lib).
// ---------------------------------------------------------------------------
const _INLINE_FN = /\^\[(?:[^\[\]]|\[[^\]]*\])*\]/g;
const _REF_FN_DEF = /^\s*\[\^[^\]]+\]:/;

function _blank(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

function maskFootnotes(text: string): string {
  text = text.replace(_INLINE_FN, (m) => _blank(m));
  const lines = text.split("\n");
  const n = lines.length;
  const out: string[] = [];
  let inDef = false;
  let i = 0;
  const indented = (s: string) => /^(\s{2,}|\t)/.test(s);
  while (i < n) {
    const ln = lines[i];
    if (_REF_FN_DEF.test(ln)) {
      inDef = true;
      out.push(_blank(ln));
      i += 1;
      continue;
    }
    if (inDef) {
      if (ln.trim() === "") {
        let j = i;
        while (j < n && lines[j].trim() === "") j += 1;
        if (j < n && indented(lines[j])) {
          out.push(_blank(ln));
          i += 1;
          continue;
        }
        inDef = false;
        out.push(ln);
        i += 1;
        continue;
      }
      if (indented(ln)) {
        out.push(_blank(ln));
        i += 1;
        continue;
      }
      inDef = false;
    }
    out.push(ln);
    i += 1;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------

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

function proseLintCategories(style: string | null): string {
  const cats = ["ai-anti-patterns", "writing-general"];
  const extra = _STYLE_CATEGORY[(style || "").toLowerCase()];
  if (extra) cats.push(extra);
  return cats.join(",");
}

function isTypDeck(path: string): boolean {
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

function editRanges(toolName: string, toolInput: Record<string, unknown>, path: string): Range[] {
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

function inRanges(lineNo: number, ranges: Range[]): boolean {
  return ranges.some(([a, b]) => a <= lineNo && lineNo <= b);
}

function runProseLint(path: string, style: string | null, ranges: Range[]): string[] {
  const { stdout, ok } = runPy([PROSE_LINT, "--only", proseLintCategories(style), path]);
  if (!ok) return [];
  const locRe = new RegExp(`^${reEscape(path)}:(\\d+):\\d+\\s+(\\[.+)$`);
  const out: string[] = [];
  for (const line of splitLines(stdout)) {
    const m = locRe.exec(line);
    if (!m) continue;
    if (inRanges(parseInt(m[1], 10), ranges)) out.push(`${pyName(path)}:${m[1]} ${m[2]}`);
  }
  return out;
}

function runStyleLint(path: string, ranges: Range[]): string[] {
  let raw: string;
  try {
    raw = readFileSync(path).toString("utf8");
  } catch {
    return [];
  }
  let tmp: string | null = null;
  let data: Record<string, unknown> = {};
  try {
    // tempfile.mkstemp(suffix=...) — a file in the SYSTEM temp dir, outside the project, so it
    // never shows up as a working-tree side effect. Unlinked in `finally`, same as the original.
    tmp = join(tmpdir(), `tmp${Math.random().toString(36).slice(2)}${pySuffix(path) || ".md"}`);
    writeFileSync(tmp, maskFootnotes(raw), "utf8");
    const { stdout } = runPy([STYLE_LINT, "--lint", "--json", tmp]);
    data = JSON.parse(stdout || "{}");
  } catch {
    return [];
  } finally {
    if (tmp) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  const out: string[] = [];
  for (const f of (data.findings as Record<string, unknown>[]) ?? []) {
    const ln = f.line as unknown;
    if (ln && inRanges(parseInt(String(ln), 10), ranges)) {
      const type = f.type === undefined || f.type === null ? "None" : String(f.type);
      const msg = f.message === undefined || f.message === null ? "" : String(f.message);
      out.push(`${pyName(path)}:${ln} [style] ${type}: ${msg}`);
    }
  }
  return out;
}

function runCheckAll(projectRoot: string, path: string, ranges: Range[]): string[] {
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
    if (PROSE_LINT_SUPERSEDES.has(name.split("/").pop() as string)) continue;
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

  let violations = runProseLint(path, style, ranges);
  violations = violations.concat(runStyleLint(path, ranges));
  if (runCheckAllFlag) violations = violations.concat(runCheckAll(projectRoot, path, ranges));

  if (!violations.length) process.exit(0);

  const output =
    "Prose quality violations (scoped to edited lines):\n" + violations.map((v) => `  • ${v}`).join("\n");
  context("PostToolUse", output);
}

await main();
