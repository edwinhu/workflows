#!/usr/bin/env bun
/**
 * Canonical TypeScript parser for the workshop Slide Spec, including the small markdown-table core
 * it needs. Hooks, CLI generation, and tests all consume this implementation so parser behavior has
 * one source of truth.
 *
 *   Only ENUMERATION lives here (S5/P27, as in the Python): the parser never joins a work-item to
 *   a produced artifact.
 *
 * CANONICAL INPUT:
 *   | Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
 *
 * Shared-v1 deliberately rejects the retired prose form.
 */

import { readFileSync, statSync } from "node:fs";

// ── Python path-string semantics ────────────────────────────────────────────────
// pathlib drops "." components and collapses repeated separators, and the guard's messages embed
// these strings verbatim ("OUTLINE.md not found at .planning/OUTLINE.md/OUTLINE.md"), so str() has
// to agree byte for byte.
export function pyPathStr(p: string): string {
  const absolute = p.startsWith("/");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const joined = parts.join("/");
  if (absolute) return "/" + joined;
  return joined === "" ? "." : joined;
}

/** str(Path(p) / name) */
export function sectionSlug(name: string): string {
  return name.normalize("NFC").trim().replace(/[^\p{L}\p{N}_]+/gu, "-").replace(/^-+|-+$/g, "");
}

export function pyJoin(p: string, name: string): string {
  return pyPathStr(p === "" ? name : `${p}/${name}`);
}

/** str(Path(p).parent) */
export function pyParent(p: string): string {
  const absolute = p.startsWith("/");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  parts.pop();
  const joined = parts.join("/");
  if (absolute) return "/" + joined;
  return joined === "" ? "." : joined;
}

/** Path(p).name */
function pyName(p: string): string {
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  return parts.length ? parts[parts.length - 1] : "";
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** str.splitlines() — no trailing empty element. */
function splitLines(text: string): string[] {
  const out = text.split(/\r\n|\r|\n/);
  if (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** str.strip(chars) — strip every leading/trailing character present in `chars`. */
function stripChars(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

// ── plan_table_core slice: markdown table location + cell extraction ────────────
const SEP_RE = /^\|?[\s:|\-]+\|[\s:|\-]+\|?$/;

/**
 * Split a markdown row on bare '|' — tolerant of an escaped `\|` (becomes a literal '|' in the
 * cell) and of a '|' inside a backtick code span.
 */
function splitCells(text: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let inCode = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "\\" && i + 1 < n && text[i + 1] === "|") {
      buf += "|";
      i += 2;
      continue;
    }
    if (c === "`") {
      inCode = !inCode;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "|" && !inCode) {
      cells.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  cells.push(buf);
  return cells;
}

function stripOuterPipes(text: string): string {
  return text.trim().replace(/^\|+/, "").replace(/\|+$/, "");
}

export function splitRow(line: string): string[] {
  return splitCells(stripOuterPipes(line)).map((c) => c.trim());
}

/** Exact match, or prefix tolerant of a parenthetical/qualifier suffix. -1 if absent. */
export function colIndex(header: string[], name: string): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i];
    if (h === name || h.startsWith(name + " ") || h.startsWith(name + "(")) return i;
  }
  return -1;
}

function coreCell(header: string[], cells: string[], name: string): string {
  const i = colIndex(header, name);
  if (i < 0) return "";
  const c = cells[i]; // Python catches IndexError -> ""
  return c === undefined ? "" : c.trim();
}

/** First table whose lowercased header is a superset of `required`; null if absent. */
export function findTable(text: string, required: string[]): { header: string[]; rows: string[][] } | null {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!(line.startsWith("|") && line.slice(1).includes("|"))) continue;
    const header = splitCells(stripOuterPipes(line)).map((c) => c.trim().toLowerCase());
    const sep = i + 1 < lines.length ? lines[i + 1].trim() : "";
    const isSep = SEP_RE.test(sep) && sep.includes("-");
    if (isSep && required.every((r) => header.includes(r))) {
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      return { header, rows };
    }
  }
  return null;
}

// ── workshop domain seam ────────────────────────────────────────────────────────
const TABLE_REQUIRED = ["slide", "section", "takeaway", "inventory"];
const REQUIRED_COLS = ["slide", "section", "takeaway", "bullets", "inventory", "visual", "notes"];
const INV_TOK_RE = /[FTRA]\d+/g;
const PROSE_SLIDE_RE = /^\s*-\s*Slide:\s*(.+)$/;
const INV_TAIL_RE = /(?:→|->)?\s*\[([^\]]*)\]\s*$/;

export type Slide = {
  num: number;
  part: string;
  section: string;
  subsection: string;
  group: string;
  takeaway: string;
  bullets: string;
  inventory: string[];
  visual: string;
  notes: string;
};

export type SlideIndex = {
  slides: Slide[];
  form: string;
  sectionOrder: string[];
  groupOrder: string[];
  outlinePath: string;
  sourcesPath: string;
  paperPath: string;
  sourcesInventory: string[];
  violations: string[];
  staleApproval: string[];
};

/** Core cell extraction + workshop's backtick tolerance (the Section column wraps `==` in ticks). */
function wsCell(header: string[], cells: string[], name: string): string {
  return stripChars(coreCell(header, cells, name), "`").trim();
}

/** Literal F/T/R/A tokens in order, de-duped. '[R1-R8]' -> ['R1','R8'] (endpoints, not expanded). */
function invTokens(cell: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (cell ?? "").matchAll(INV_TOK_RE)) {
    const tok = m[0];
    if (!seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

export function findSlideTable(text: string) {
  return findTable(text, TABLE_REQUIRED);
}

function parseTable(text: string, idx: SlideIndex): void {
  const found = findSlideTable(text);
  if (!found) return;
  const { header, rows } = found;
  idx.form = "table";
  const missing = REQUIRED_COLS.filter((c) => colIndex(header, c) < 0);
  if (missing.length) {
    idx.violations.push(`Slide Spec table missing required column(s): ${missing.join(", ")}.`);
  }
  const seen = new Set<number>();
  for (const cells of rows) {
    const slide = wsCell(header, cells, "slide");
    const m = /^\s*\**\s*(\d+)\./.exec(slide);
    if (!m) {
      idx.violations.push(`Slide row '${slide.slice(0, 40)}' has no leading 'N.' number.`);
      continue;
    }
    const n = parseInt(m[1], 10);
    if (seen.has(n)) idx.violations.push(`Slide ${n}: duplicate slide number.`);
    seen.add(n);
    // The Section cell may carry both the `=` Part and the `==` subsection, separator
    // backtick-wrapped per the SKILL format ("Part 1: Motivation `==` The Rise").
    const section = wsCell(header, cells, "section").replace(/`/g, " ");
    const partIdx = section.indexOf("==");
    const secRaw = partIdx < 0 ? section : section.slice(0, partIdx);
    const subRaw = partIdx < 0 ? "" : section.slice(partIdx + 2);
    const sec = secRaw.replace(/=/g, "").trim() || section.replace(/=/g, "").trim();
    const sub = subRaw.trim();
    const takeaway = wsCell(header, cells, "takeaway");
    const visual = wsCell(header, cells, "visual");
    const notes = wsCell(header, cells, "notes");
    const invCell = wsCell(header, cells, "inventory");
    for (const [label, val] of [
      ["Takeaway", takeaway],
      ["Bullets", wsCell(header, cells, "bullets")],
      ["Inventory", invCell],
      ["Notes", notes],
    ] as const) {
      if (!val || val.toUpperCase() === "N/A") {
        idx.violations.push(`Slide ${n}: ${label} is empty/N/A — required for an executable slide spec.`);
      }
    }
    if (!visual || visual.toUpperCase() === "N/A") {
      idx.violations.push(`Slide ${n}: Visual is empty/N/A — use 'none' if intentional.`);
    }
    const inv = invTokens(invCell);
    if (invCell && !inv.length) {
      idx.violations.push(`Slide ${n}: Inventory '${invCell.slice(0, 30)}' has no F/T/R/A id.`);
    }
    const group = sub ? `${sec} / ${sub}` : sec;
    idx.slides.push({
      num: n,
      part: "",
      section: sec,
      subsection: sub,
      group,
      takeaway,
      bullets: wsCell(header, cells, "bullets"),
      inventory: inv,
      visual,
      notes,
    });
  }
  if (!seen.size) idx.violations.push("Slide Spec table has no slide rows.");
}

function parseProse(text: string, idx: SlideIndex): void {
  idx.form = "prose";
  let part = "";
  let section = "";
  let subsection = "";
  let n = 0;
  for (const raw of splitLines(text)) {
    const line = raw.replace(/\s+$/, ""); // rstrip
    const s = line.trim();
    if (s.startsWith("### ")) {
      part = s.slice(4).trim();
      continue;
    }
    if (s.startsWith("== ")) {
      subsection = s.slice(3).trim();
      continue;
    }
    if (s.startsWith("= ")) {
      section = s.slice(2).trim();
      subsection = "";
      continue;
    }
    const pm = PROSE_SLIDE_RE.exec(line);
    if (!pm) continue;
    let rest = pm[1].trim();
    // inventory tail
    let invCell = "";
    const tail = INV_TAIL_RE.exec(rest);
    if (tail) {
      invCell = tail[1];
      rest = rest.slice(0, tail.index).replace(/\s+$/, "");
    }
    // takeaway = leading DOUBLE-quoted span; bullets = remainder after the em-dash/hyphen
    // separator. Closing delimiter is a double quote ONLY — an apostrophe must not close it.
    let takeaway = rest;
    let bullets = "";
    const qm = /^["“](.+?)["”](.*)$/.exec(rest);
    if (qm) {
      takeaway = qm[1].trim();
      let after = qm[2].trim();
      after = after.replace(/^\s*[—–-]\s*/, "");
      bullets = after.trim();
    }
    n += 1;
    const group = subsection ? `${section} / ${subsection}` : section;
    const inv = invTokens(invCell);
    idx.slides.push({
      num: n,
      part,
      section,
      subsection,
      group,
      takeaway,
      bullets,
      inventory: inv,
      visual: "",
      notes: "",
    });
    // Prose-form violations (4-field subset — Visual/Notes NOT required here, back-compat):
    if (!takeaway) idx.violations.push(`Slide ${n}: no takeaway sentence parsed from prose row.`);
    if (!inv.length) {
      idx.violations.push(
        `Slide ${n} ("${takeaway.slice(0, 30)}"): no F/T/R/A inventory id — every slide must cite ≥1.`,
      );
    }
  }
}

function staleApproval(planning: string, idx: SlideIndex): void {
  const approved = pyJoin(planning, "OUTLINE_APPROVED.md");
  if (!isFile(approved)) return;
  const txt = readFileSync(approved, "utf8");
  for (const [key, live] of [
    ["slide_count", idx.slides.length],
    ["section_count", idx.sectionOrder.length],
  ] as const) {
    const m = new RegExp(`^${key}:\\s*(\\d+)`, "m").exec(txt);
    if (m && parseInt(m[1], 10) !== live) {
      idx.staleApproval.push(
        `OUTLINE_APPROVED.md ${key}=${m[1]} but live OUTLINE.md has ${live} — ` +
          "the approval predates a structure change; re-approve before generating.",
      );
    }
  }
}

/**
 * Parse OUTLINE.md (table OR prose) into a SlideIndex work-list. `arg` may be the OUTLINE.md path,
 * the project root, or its .planning dir. The guard consumes `.violations`.
 */
export function buildIndex(arg: string): SlideIndex {
  const p = pyPathStr(arg);
  let outline: string;
  if (isFile(p) && pyName(p).endsWith(".md")) {
    outline = p;
  } else {
    const planning = isDir(pyJoin(p, ".planning")) ? pyJoin(p, ".planning") : p;
    outline = pyJoin(planning, "OUTLINE.md");
  }
  const idx: SlideIndex = {
    slides: [],
    form: "none",
    sectionOrder: [],
    groupOrder: [],
    outlinePath: outline,
    sourcesPath: "",
    paperPath: "",
    sourcesInventory: [],
    violations: [],
    staleApproval: [],
  };
  if (!isFile(outline)) {
    idx.violations.push(`OUTLINE.md not found at ${outline}`);
    return idx;
  }
  const planning = pyParent(outline);
  const sources = pyJoin(planning, "SOURCES.md");
  idx.sourcesPath = isFile(sources) ? sources : "";
  let src = "";
  if (idx.sourcesPath) {
    src = readFileSync(sources, "utf8");
    // first "- Path:" line (tolerate bold markers: "- **Path:**"); it is the primary paper.
    const pm = /^\s*-\s*\*{0,2}Path:?\*{0,2}\s*(.+?)\s*$/m.exec(src);
    if (pm) {
      const raw = pm[1].trim();
      idx.paperPath = raw.startsWith("~") ? expandUser(raw) : raw;
    }
  }
  const text = readFileSync(outline, "utf8");

  if (findSlideTable(text)) {
    parseTable(text, idx);
  } else {
    idx.form = "none";
    idx.violations.push(
      "No executable canonical Slide Spec table found: " +
        "Slide|Section|Takeaway|Bullets|Inventory|Visual|Notes is required for shared-v1 workshop generation.",
    );
  }

  // distinct section / group order (document order)
  for (const sl of idx.slides) {
    if (sl.section && !idx.sectionOrder.includes(sl.section)) idx.sectionOrder.push(sl.section);
    if (sl.group && !idx.groupOrder.includes(sl.group)) idx.groupOrder.push(sl.group);
  }

  // dangling inventory ref check + the canonical ID universe (only if SOURCES present)
  if (idx.sourcesPath) {
    const known = new Set<string>((src.match(INV_TOK_RE) ?? []) as string[]);
    idx.sourcesInventory = [...known].sort((a, b) =>
      a[0] === b[0] ? parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10) : a[0] < b[0] ? -1 : 1,
    );
    for (const sl of idx.slides) {
      for (const tok of sl.inventory) {
        if (!known.has(tok)) {
          idx.violations.push(`Slide ${sl.num}: inventory id ${tok} not found in SOURCES.md.`);
        }
      }
    }
  }

  staleApproval(planning, idx);
  return idx;
}

/** Path.expanduser() for a leading "~". */
function expandUser(p: string): string {
  const home = process.env.HOME ?? "";
  if (p === "~") return home || p;
  if (p.startsWith("~/")) return home ? pyPathStr(home + "/" + p.slice(2)) : p;
  return p;
}
