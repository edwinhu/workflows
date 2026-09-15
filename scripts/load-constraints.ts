#!/usr/bin/env bun
/**
 * Load constraint .md prose for a skill, filtered by applies-to frontmatter.
 * TypeScript port of load-constraints.py.
 *
 * Mirrors run-constraints.py's auto-discovery but for .md context injection.
 * Globs constraints/*.md, parses applies-to, outputs matching content.
 *
 * Usage:
 *     bun scripts/load-constraints.ts workshop
 *     bun scripts/load-constraints.ts workshop-revise
 *
 * Designed to be called from a SKILL.md bang line:
 *     !`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts skill-name`
 *
 * PORT NOTE — this is a language port, not a refactor. The output is consumed as context by 37 skill
 * call sites and its size is a tracked number (a `ds` load is exactly 29,092 bytes after the
 * 2026-07-29 scoping fix), so byte-for-byte fidelity with the Python is the whole requirement.
 */

import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const BANG_MARKER = "/tmp/workflows-constraints-loaded.json";

type Meta = Record<string, string | string[]>;

/**
 * Parse YAML-ish frontmatter. Returns [metadata, body].
 *
 * Faithful to the Python: it splits on "---" with maxsplit=2, which means a body containing "---"
 * keeps everything after the second delimiter intact. `String.split("---", 3)` is NOT equivalent —
 * it DROPS the remainder rather than keeping it in the last element, which would silently truncate
 * every constraint body at its first horizontal rule.
 */
export function parseFrontmatter(text: string): [Meta, string] {
  if (!text.startsWith("---")) return [{}, text];

  const first = text.indexOf("---");
  const second = text.indexOf("---", first + 3);
  if (second === -1) return [{}, text];

  const fmBlock = text.slice(first + 3, second);
  const body = text.slice(second + 3);

  const meta: Meta = {};
  for (const line of fmBlock.trim().split("\n")) {
    if (!line.includes(":")) continue;
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      const items = val
        .slice(1, -1)
        .split(",")
        .map((i) => i.trim().replace(/^['"]|['"]$/g, ""))
        .filter((i) => i);
      meta[key] = items;
    } else {
      meta[key] = val;
    }
  }
  return [meta, body];
}

/**
 * Check if a skill name matches the applies-to list.
 *
 * Matching is name-boundary aware, mirroring run-constraints.py's `_applies`:
 *   - "all"          -> matches everything
 *   - entry == skill -> exact match ("ds-plan" ⊃ ds-plan)
 *   - "ds-*"         -> family glob: the ds entry point AND every ds-<phase>
 *
 * A constraint reaches only the skills it NAMES. Family scope is opt-in via the `-*` glob, never
 * implied. A bare substring test would be wrong: it made "ds" match "wrds", so the /ds entry point
 * silently loaded wrds-sge-enforcement.
 *
 * REMOVED 2026-07-29 — reverse inheritance (`entry.startswith(skill + "-")`). Its stated rationale
 * was "the workflow entry point picks up its own phase constraints", but entry points do not RUN
 * those phases: /ds is brainstorm and was being handed 64 KB of rules for phases it never executes,
 * including rules about touching data that its own hook-enforced Iron Law forbids. Measured: 69% of
 * /ds's load, 63% of /writing's, 45% of /dev's. No phase skill was affected, because every phase
 * names itself explicitly.
 */
export function skillMatches(appliesTo: string[], skillName: string): boolean {
  const skill = skillName.toLowerCase();
  for (const entry of appliesTo) {
    const e = entry.toLowerCase();
    if (e === "all") return true;
    if (e === skill) return true;
    if (e.endsWith("-*")) {
      const prefix = e.slice(0, -2);
      // "ds-*" covers the entry point itself and every ds-<phase>
      if (skill === prefix || skill.startsWith(prefix + "-")) return true;
    }
  }
  return false;
}

export interface LoadConstraintsOptions {
  skillName: string;
  constraintsDir: string;
  markerPath?: string;
}

export interface ConstraintLoadEvidence {
  skill: string;
  matched: number;
  skipped: number;
  constraints: string[];
  markerPath: string;
  markerWritten: boolean;
}

export interface ConstraintLoadResult {
  output: string;
  evidence: ConstraintLoadEvidence;
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

export function loadConstraints(options: LoadConstraintsOptions): ConstraintLoadResult {
  const { skillName, constraintsDir } = options;
  const markerPath = options.markerPath ?? BANG_MARKER;
  if (!skillName) throw new Error("Constraint skill name must be explicit");
  if (!constraintsDir) throw new Error("Constraint directory must be explicit");

  const canonicalRoot = realpathSync(constraintsDir);
  if (!lstatSync(canonicalRoot).isDirectory()) throw new Error("Constraint root must be a directory");
  const entries = readdirSync(canonicalRoot).filter((name) => name.endsWith(".md")).sort();
  const outputParts: string[] = [];
  const constraints: string[] = [];
  // Every scope the corpus declares, so a refusal can name the alternatives instead of only
  // reporting that the one asked for matched nothing.
  const scopes = new Set<string>();
  // A comma list is ONE query over several scopes — the shape `rules-for slides,notes` has always
  // taken. Splitting here keeps all three tools answering the same argument.
  const wanted = skillName.split(",").map((w) => w.trim()).filter(Boolean);
  const indexRows: [string, string][] = [];
  let matched = 0;
  let skipped = 0;

  for (const name of entries) {
    const constraintPath = realpathSync(join(canonicalRoot, name));
    if (!isContained(canonicalRoot, constraintPath)) {
      throw new Error(`Constraint file is outside canonical constraint root: ${name}`);
    }
    if (!lstatSync(constraintPath).isFile()) throw new Error(`Constraint must be a file: ${name}`);
    const text = readFileSync(constraintPath, "utf8");
    const [meta, body] = parseFrontmatter(text);

    let appliesTo = meta["applies-to"] ?? [];
    if (typeof appliesTo === "string") appliesTo = [appliesTo];
    if (!appliesTo.length) appliesTo = ["all"];
    for (const sc of appliesTo as string[]) scopes.add(sc);

    if (wanted.some((w) => skillMatches(appliesTo as string[], w))) {
      const constraintName = (meta["name"] as string) || name.replace(/\.md$/, "");
      outputParts.push(`# Constraint: ${constraintName}`);
      outputParts.push(body.trim());
      outputParts.push("");
      constraints.push(name);
      indexRows.push([constraintName, constraintPath]);
      matched++;
    } else {
      skipped++;
    }
  }

  const output = outputParts.length
    ? `# Loaded ${matched} constraints for ${skillName} (${skipped} skipped)\n${outputParts.join("\n")}`
    : "";
  const evidence: ConstraintLoadEvidence = {
    skill: skillName,
    matched,
    skipped,
    constraints,
    markerPath,
    markerWritten: false,
  };

  if (output) {
    try {
      mkdirSync(dirname(markerPath), { recursive: true });
      evidence.markerWritten = true;
      writeFileSync(markerPath, JSON.stringify(evidence));
    } catch {
      evidence.markerWritten = false;
    }
  }

  const index = outputParts.length
    ? `# Constraints for ${skillName} (${matched})\n\n` +
      indexRows.sort().map(([n, f]) => `- **${n}**  \`${f}\``).join("\n")
    : "";
  return { output, evidence, scopes: [...scopes].sort(), index };
}

// CLI entry point. Guarded by import.meta.main so importing this module for its exported
// parseFrontmatter/skillMatches (the test does) does not execute the loader and dump 29 KB of
// constraint prose into the test output.
if (import.meta.main) {
const argv = process.argv.slice(2);
if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
  console.log(
    [
      "Load constraint .md prose for a skill, filtered by applies-to frontmatter.",
      "",
      "Usage:",
      "    bun scripts/load-constraints.ts workshop",
      "    bun scripts/load-constraints.ts workshop-revise",
    ].join("\n"),
  );
  process.exit(0);
}

// One argument shape across all three constraint tools: <scope> [--dir DIR] [--index].
const skillName = argv[0];
let constraintsDir = "";
// INDEX is the default in all three loaders: the prose for one scope is 38,524 bytes against 1,386
// for the index, and a load-time injection is paid on every invocation. --full gives the bodies.
let indexOnly = true;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--index") indexOnly = true;
  else if (argv[i] === "--full") indexOnly = false;
  else if (argv[i] === "--dir" && argv[i + 1]) constraintsDir = argv[++i];
  else {
    console.error(`Usage: load-constraints.ts <skill-name> [--dir <constraints-dir>] [--index|--full]`);
    process.exit(2);
  }
}
if (!constraintsDir) constraintsDir = resolve(import.meta.dir, "..", "constraints");
// Exit 2 for every could-not-run, matching `rules-for` and teaching's loader. Neither of the codes
// this used to return aborts a skill load: a bang tolerates exit 1, and exit 0 with an empty body
// renders as "this skill has no constraints" — which is what a missing corpus looked like.
try {
  const result = loadConstraints({ skillName, constraintsDir });
  if (result.output) {
    console.log(indexOnly ? result.index : result.output);
  } else {
    console.error(
      `Error: no constraint is scoped to '${skillName}' — the scope names nothing, which is not ` +
        `an empty corpus. Scopes in this corpus: ${result.scopes?.join(", ") || "(none declared)"}`,
    );
    process.exit(2);
  }
} catch (e) {
  // Named, not swallowed: a bare catch reported "not found" for a permission error and a parse
  // error alike, so the one cause the message states was often not the cause.
  console.error(`Error: cannot read the constraint corpus at ${constraintsDir}: ${(e as Error).message}`);
  process.exit(2);
}
}
