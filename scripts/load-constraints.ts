#!/usr/bin/env bun
/**
 * Load constraint .md prose for a skill, filtered by applies-to frontmatter.
 * TypeScript port of load-constraints.py.
 *
 * Mirrors check-all.py's auto-discovery but for .md context injection.
 * Globs references/constraints/*.md, parses applies-to, outputs matching content.
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

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
function parseFrontmatter(text: string): [Meta, string] {
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
 * Matching is name-boundary aware, mirroring check-all.py's `_applies`:
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

function loadConstraints(skillName: string, constraintsDir?: string): string {
  const cdir = constraintsDir ?? resolve(import.meta.dir, "..", "references", "constraints");

  let entries: string[];
  try {
    entries = readdirSync(cdir);
  } catch {
    console.error(`Error: ${cdir} not found`);
    process.exit(1);
  }

  const outputParts: string[] = [];
  let matched = 0;
  let skipped = 0;

  for (const name of entries.filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(join(cdir, name), "utf8");
    const [meta, body] = parseFrontmatter(text);

    let appliesTo = meta["applies-to"] ?? [];
    if (typeof appliesTo === "string") appliesTo = [appliesTo];
    if (!appliesTo.length) appliesTo = ["all"];

    if (skillMatches(appliesTo as string[], skillName)) {
      const constraintName = (meta["name"] as string) || name.replace(/\.md$/, "");
      outputParts.push(`# Constraint: ${constraintName}`);
      outputParts.push(body.trim());
      outputParts.push("");
      matched++;
    } else {
      skipped++;
    }
  }

  if (!outputParts.length) {
    console.error(`# No constraints found for skill: ${skillName}`);
    return "";
  }

  try {
    writeFileSync(BANG_MARKER, JSON.stringify({ skill: skillName, matched, skipped }));
  } catch {
    // marker is advisory; never fail a skill load over it
  }

  const header = `# Loaded ${matched} constraints for ${skillName} (${skipped} skipped)\n`;
  return header + outputParts.join("\n");
}

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

const skillName = argv[0];
const constraintsDir = argv.length >= 3 && argv[1] === "--dir" ? argv[2] : undefined;
const output = loadConstraints(skillName, constraintsDir);
if (output) console.log(output);
