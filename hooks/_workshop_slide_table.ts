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
import {
  classifyBuiltInArtifactLayout,
  resolveGeneratedPlanReviewState,
  type ArtifactError,
} from "../workflows/lib/approved-artifact.ts";

// ── Python path-string semantics ────────────────────────────────────────────────
// pathlib drops "." components and collapses repeated separators, so generated-plan guard
// diagnostics must use matching path strings byte for byte.
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

/** First markdown table in the supplied section, with literal normalized cells. */
export function findTable(text: string): { header: string[]; rows: string[][] } | null {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!(line.startsWith("|") && line.slice(1).includes("|"))) continue;
    const sep = i + 1 < lines.length ? lines[i + 1].trim() : "";
    if (!SEP_RE.test(sep) || !sep.includes("-")) continue;
    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      rows.push(splitRow(lines[j]));
      j += 1;
    }
    return { header: splitRow(line), rows };
  }
  return null;
}

// ── workshop domain seam ────────────────────────────────────────────────────────
const REQUIRED_COLS = ["Slide", "Section", "Takeaway", "Bullets", "Inventory", "Visual", "Notes"];
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
  ok: boolean;
  planPath: string;
  planFile: string;
  planHash: string;
  reviewStatePath: string;
  receipt: { workflow: string; plan_file: string; plan_hash: string; status: string } | null;
  reviewStatus: string;
  layout: string;
  conversionRequired: boolean;
  sourcesPath: string;
  paperPath: string;
  sourcesInventory: string[];
  violations: string[];
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
  return findTable(text);
}

function parseTable(table: { header: string[]; rows: string[][] }, idx: SlideIndex): void {
  const header = table.header.map(cell => cell.toLowerCase());
  const { rows } = table;
  idx.form = "table";
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
      // Section is validated HERE and not merely downstream. An empty Section cell used to parse
      // cleanly, yield an empty `group`, get skipped by the `if (sl.group && ...)` guard when
      // groupOrder is built, and therefore vanish from generation entirely — workshop-generate.js
      // enumerates groupOrder, so the slide was never dispatched to any section agent. The deck came
      // out short with no finding naming the missing slide. Silent omission, not a loud failure.
      ["Section", sec],
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

const REQUIRED_PLAN_SECTIONS = [
  "Presentation Intent",
  "Audience, Venue, Duration, and Proportions",
  "Source Paper",
  "Source Inventory",
  "Slide Spec",
  "Outputs and Verification",
  "Review Surfaces",
] as const;

function sectionBody(plan: string, heading: string): string | undefined {
  const lines = splitLines(plan);
  const wanted = `## ${heading}`;
  const start = lines.findIndex(line => line.trim() === wanted);
  if (start < 0) return undefined;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

function isArtifactError(value: unknown): value is ArtifactError {
  return !!value && typeof value === "object" && "code" in value && "message" in value;
}

/**
 * Authenticate the receipt-selected generated workshop PLAN and compile its native Source Paper,
 * Source Inventory, and seven-column Slide Spec sections. Legacy files are diagnostics only; this
 * parser never discovers a replacement by filename, directory listing, or LLM fallback.
 */
export function buildIndex(project: string): SlideIndex {
  const idx: SlideIndex = {
    slides: [], form: "none", sectionOrder: [], groupOrder: [], ok: false, planPath: "", planFile: "",
    planHash: "", reviewStatePath: "", receipt: null, reviewStatus: "", layout: "canonical", conversionRequired: false,
    sourcesPath: "", paperPath: "", sourcesInventory: [], violations: [],
  };
  const root = pyPathStr(project);
  try {
    idx.layout = classifyBuiltInArtifactLayout(root, "workshop");
  } catch {
    idx.violations.push(`Workshop project root is inaccessible: ${root}`);
    return idx;
  }
  if (idx.layout === "legacy" || idx.layout === "conflict") {
    idx.conversionRequired = true;
    idx.violations.push(
      idx.layout === "legacy"
        ? "Legacy workshop planning artifacts are conversion input only; create and review a fresh receipt-selected generated plan."
        : "Generated and legacy workshop planning artifacts conflict; preserve legacy files as provenance and resolve with a fresh generated plan.",
    );
    return idx;
  }
  const resolved = resolveGeneratedPlanReviewState(root, "workshop");
  if (isArtifactError(resolved)) {
    idx.violations.push(`Workshop generated-plan receipt is invalid: ${resolved.message}`);
    return idx;
  }
  idx.planPath = resolved.planPath;
  idx.planFile = resolved.planFile;
  idx.planHash = resolved.hash;
  idx.reviewStatePath = pyJoin(pyJoin(root, ".planning"), ".state/review.json");
  idx.receipt = { workflow: resolved.receipt.workflow, plan_file: resolved.receipt.plan_file, plan_hash: resolved.receipt.plan_hash, status: resolved.receipt.status };
  idx.reviewStatus = resolved.receipt.status;
  const plan = readFileSync(resolved.planPath, "utf8");
  const headings = splitLines(plan).map(line => line.trim());
  const observedH2 = headings.filter(line => /^##\s+/.test(line)).map(line => line.replace(/^##\s+/, ""));
  if (JSON.stringify(observedH2) !== JSON.stringify(REQUIRED_PLAN_SECTIONS)) {
    idx.violations.push(`PLAN level-2 heading sequence must equal exactly: ${REQUIRED_PLAN_SECTIONS.join(" | ")}.`);
  }
  for (const heading of REQUIRED_PLAN_SECTIONS) {
    const count = headings.filter(line => line === `## ${heading}`).length;
    if (count !== 1) idx.violations.push(`PLAN requires exactly one level-2 section: ## ${heading} (found ${count}).`);
  }
  const sourcePaper = sectionBody(plan, "Source Paper") ?? "";
  const paper = /^\s*-\s*\*{0,2}Path:?\*{0,2}\s*(.+?)\s*$/m.exec(sourcePaper);
  if (!paper) idx.violations.push("PLAN Source Paper requires a '- Path: <absolute paper path>' row.");
  else idx.paperPath = paper[1].trim().startsWith("~") ? expandUser(paper[1].trim()) : paper[1].trim();
  const inventory = sectionBody(plan, "Source Inventory") ?? "";
  const known = new Set<string>(inventory.match(INV_TOK_RE) ?? []);
  idx.sourcesInventory = [...known].sort((a, b) =>
    a[0] === b[0] ? parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10) : a[0] < b[0] ? -1 : 1,
  );
  if (!idx.sourcesInventory.length) idx.violations.push("PLAN Source Inventory requires at least one F/T/R/A item.");
  const slideSpec = sectionBody(plan, "Slide Spec") ?? "";
  const table = findSlideTable(slideSpec);
  if (!table) {
    idx.violations.push("PLAN Slide Spec requires the canonical seven-column Slide|Section|Takeaway|Bullets|Inventory|Visual|Notes table.");
  } else if (JSON.stringify(table.header) !== JSON.stringify(REQUIRED_COLS)) {
    idx.violations.push("PLAN Slide Spec header must contain exactly seven ordered columns: Slide|Section|Takeaway|Bullets|Inventory|Visual|Notes.");
  } else if (table.rows.some(row => row.length !== REQUIRED_COLS.length)) {
    idx.violations.push("Every PLAN Slide Spec data row must contain exactly seven cells.");
  } else {
    parseTable(table, idx);
  }
  // A group that REAPPEARS after another group intervened cannot survive generation intact.
  // groupOrder dedupes globally, and workshop-generate.js then collects every slide matching a group
  // key and sorts by slide number — so two noncontiguous runs of "Part 2 / Setup" silently collapse
  // into one fragment under one heading, reordering slides across the sections that separated them.
  // The plan's section boundaries are lost with no finding. Reject it at parse time instead: the
  // author either meant one contiguous run, or meant two distinct sections that need distinct names.
  // CONTIGUITY IS A PROPERTY OF SLIDE ORDER, NOT ROW ORDER. `idx.slides` is in table-row order, and
  // nothing requires the rows to ascend — workshop-generate.js sorts each section's slides by
  // `Number(a.num)` itself, so a plan listing 1, 3, 2 is legal and renders correctly today. Scanning
  // raw row order would reject it as a resumed section, which is a spurious block on a valid plan.
  const byNumber = [...idx.slides].sort((a, b) => Number(a.num) - Number(b.num));
  for (const sl of idx.slides) {
    if (sl.section && !idx.sectionOrder.includes(sl.section)) idx.sectionOrder.push(sl.section);
  }
  let previousGroup = "";
  const seenGroups: string[] = [];
  for (const sl of byNumber) {
    if (sl.group && sl.group !== previousGroup && seenGroups.includes(sl.group)) {
      idx.violations.push(`Slide ${sl.num}: section "${sl.group}" resumes after another section intervened. Sections must occupy one contiguous slide run — merge them or give them distinct names.`);
    }
    if (sl.group) previousGroup = sl.group;
    if (sl.group && !seenGroups.includes(sl.group)) seenGroups.push(sl.group);
    if (sl.group && !idx.groupOrder.includes(sl.group)) idx.groupOrder.push(sl.group);
    for (const tok of sl.inventory) if (!known.has(tok)) idx.violations.push(`Slide ${sl.num}: inventory id ${tok} not found in PLAN Source Inventory.`);
  }
  idx.ok = idx.violations.length === 0;
  return idx;
}

/** Path.expanduser() for a leading "~". */
function expandUser(p: string): string {
  const home = process.env.HOME ?? "";
  if (p === "~") return home || p;
  if (p.startsWith("~/")) return home ? pyPathStr(home + "/" + p.slice(2)) : p;
  return p;
}
