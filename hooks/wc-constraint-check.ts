#!/usr/bin/env bun
/**
 * PostToolUse hook: runs every constraint check that applies to workflow-creator
 * after edits to workflow-creator files.
 *
 * "Applies to workflow-creator" is read from each constraint .md's `applies-to`
 * frontmatter (the same source load-constraints.py uses) — NOT a `wc-*` name glob.
 * So auto-loader-usage.py, atomic-constraints.py, and the wc-*.py checks all fire,
 * keeping the PostToolUse hook (Layer 3) aligned with the full applicable set
 * (check-all.py's wc-filtered subset).
 *
 * PORT NOTE — why a Python subprocess remains
 *   The constraint checks ARE Python modules: the original imports each
 *   references/constraints/<stem>.py by path and calls `mod.check(context)`. There is no
 *   TypeScript equivalent of executing them, and reimplementing 7 constraint scanners in TS
 *   would be a rewrite, not a port. So the SELECTION half (frontmatter applies-to parsing,
 *   CI_ONLY skip, .md/.py pairing) is ported to TS — that is this hook's own logic, and
 *   load-constraints.py's parse_frontmatter/skill_matches are reproduced exactly below — while
 *   the EXECUTION half is delegated to a one-shot `python3 -c` driver that mirrors the original
 *   loop verbatim, including its bare `except Exception: pass` per module.
 *
 *   The driver captures anything a constraint module prints and hands it back separately, so
 *   module output still reaches this hook's stdout BEFORE the violations blob, in the same order
 *   the original produced it. Without that, a chatty constraint would print into the driver's
 *   own stdout and corrupt the JSON envelope.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { allow, pyJson, readPayload } from "./_gate_common.ts";

const WC_PATHS = ["skills/workflow-creator/", "references/constraints/wc-"];
const TARGET_SKILL = "workflow-creator";

// Checks that apply-to workflow-creator but are REPO-WIDE structural scans, not
// edit-relevant guards — they belong in check-all.py / CI (Leg 1), not in a
// per-edit PostToolUse hook. Documented, justified gap: check-all.py still runs them.
const CI_ONLY = new Set(["atomic-constraints"]);

const REPO_ROOT = dirname(import.meta.dir);
const CONSTRAINTS_DIR = join(REPO_ROOT, "references", "constraints");

/** Python's `str.splitlines()`. */
function pySplitlines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Python's `str.strip("'\"")`: strip BOTH characters from both ends, repeatedly. */
function stripQuotes(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === "'" || s[a] === '"')) a++;
  while (b > a && (s[b - 1] === "'" || s[b - 1] === '"')) b--;
  return s.slice(a, b);
}

/** `text.split("---", 2)` — Python maxsplit semantics (at most 3 pieces). */
function splitOnce3(text: string, sep: string): string[] {
  const i = text.indexOf(sep);
  if (i < 0) return [text];
  const j = text.indexOf(sep, i + sep.length);
  if (j < 0) return [text.slice(0, i), text.slice(i + sep.length)];
  return [text.slice(0, i), text.slice(i + sep.length, j), text.slice(j + sep.length)];
}

/** load-constraints.py parse_frontmatter — metadata only (the body is unused here). */
function parseFrontmatter(text: string): Record<string, string | string[]> {
  if (!text.startsWith("---")) return {};
  const parts = splitOnce3(text, "---");
  if (parts.length < 3) return {};

  const meta: Record<string, string | string[]> = {};
  for (const line of pySplitlines(parts[1].trim())) {
    if (!line.includes(":")) continue;
    const i = line.indexOf(":");
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      const items = val.slice(1, -1).split(",").map((it) => stripQuotes(it.trim()));
      meta[key] = items.filter((it) => it !== "");
    } else {
      meta[key] = val;
    }
  }
  return meta;
}

/** load-constraints.py skill_matches: "all", exact, or the opt-in `-*` family glob. */
function skillMatches(appliesTo: string[], skillName: string): boolean {
  const skill = skillName.toLowerCase();
  for (const entry of appliesTo) {
    const e = entry.toLowerCase();
    if (e === "all") return true;
    if (e === skill) return true;
    if (e.endsWith("-*")) {
      const prefix = e.slice(0, -2);
      if (skill === prefix || skill.startsWith(prefix + "-")) return true;
    }
  }
  return false;
}

/** True iff the .md's applies-to includes workflow-creator or 'all' (absent ⇒ 'all'). */
function appliesToTarget(mdPath: string): boolean {
  let text: string;
  try {
    text = readFileSync(mdPath, "utf8");
  } catch {
    return false;
  }
  const meta = parseFrontmatter(text);
  let appliesTo = meta["applies-to"] ?? [];
  if (typeof appliesTo === "string") appliesTo = [appliesTo];
  if (!appliesTo.length) appliesTo = ["all"];
  return skillMatches(appliesTo, TARGET_SKILL);
}

const stemOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/** Stems whose .md applies to workflow-creator AND have a co-located .py. */
function applicableChecks(): string[] {
  let names: string[];
  try {
    names = readdirSync(CONSTRAINTS_DIR);
  } catch {
    return [];
  }
  const pyStems = new Set(names.filter((n) => n.endsWith(".py")).map(stemOf));
  const out: string[] = [];
  for (const md of names.filter((n) => n.endsWith(".md")).sort()) {
    const stem = stemOf(md);
    if (CI_ONLY.has(stem)) continue;
    if (pyStems.has(stem) && appliesToTarget(join(CONSTRAINTS_DIR, md))) {
      out.push(join(CONSTRAINTS_DIR, `${stem}.py`));
    }
  }
  return out;
}

/**
 * Mirror of the original's import/check loop, run in one Python process.
 * Prints {"out": <anything the modules printed>, "failures": [...]} on real stdout.
 */
const DRIVER = `
import contextlib, importlib.util, io, json, sys
from pathlib import Path

paths = sys.argv[1:-1]
context = {"cwd": sys.argv[-1]}
failures = []
buf = io.StringIO()
real = sys.stdout
with contextlib.redirect_stdout(buf):
    for p in paths:
        stem = Path(p).stem
        try:
            spec = importlib.util.spec_from_file_location(stem, p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            violations = mod.check(context)
            if violations:
                failures.extend("%s: %s" % (stem, v) for v in violations)
        except Exception:
            pass
real.write(json.dumps({"out": buf.getvalue(), "failures": failures}))
`;

let payload: unknown;
try {
  payload = await readPayload();
} catch {
  // json.load raised — the original's try/except exits 0 here.
  allow();
}

// FAITHFUL ODDITY: only the PARSE is guarded in the original. A payload that parses to a
// non-dict (a bare JSON string, a list) reaches `hook_input.get(...)` and dies with an
// uncaught AttributeError — exit 1, traceback on stderr. Silently treating it as an empty
// payload would turn that crash into an allow, which the golden's malformed-stdin case
// (whose stdin is the JSON string "this is not json") catches.
if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
  throw new TypeError(`'${payload === null ? "NoneType" : typeof payload}' object has no attribute 'get'`);
}
const hookInput = payload as Record<string, unknown>;

const toolName = String(hookInput!.tool_name ?? "");
const toolInput = (hookInput!.tool_input as Record<string, unknown>) ?? {};

if (toolName !== "Write" && toolName !== "Edit") allow();

const filePath = String(toolInput.file_path ?? "");
if (!WC_PATHS.some((segment) => filePath.includes(segment))) allow();

const checks = applicableChecks();
let failures: string[] = [];
if (checks.length) {
  const r = Bun.spawnSync(["uv", "run", "python3", "-c", DRIVER, ...checks, REPO_ROOT], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const raw = new TextDecoder().decode(r.stdout ?? new Uint8Array());
  try {
    const parsed = JSON.parse(raw) as { out?: string; failures?: string[] };
    if (parsed.out) process.stdout.write(parsed.out);
    failures = parsed.failures ?? [];
  } catch {
    // The driver itself died — the original swallows per-module errors the same way.
  }
}

if (failures.length) {
  const msg = "Constraint violations after edit:\n" + failures.map((f) => `  - ${f}`).join("\n");
  console.log(pyJson({ hookSpecificOutput: { hookEventName: "PostToolUse", outputToUser: msg } }));
}

process.exit(0);
