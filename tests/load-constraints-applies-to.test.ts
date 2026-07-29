/**
 * Tests for scripts/load-constraints.ts `skillMatches` scoping.
 *
 * Ported from tests/load_constraints_applies_to_test.py when the loader moved to TypeScript. The
 * test must exercise the SHIPPING implementation — a Python test against a deleted Python module
 * proves nothing about what actually runs.
 *
 * WHAT IT CATCHES
 *     The matcher once used a bare substring test (`skill_name in entry`), so ANY skill whose name
 *     was a substring of an applies-to entry silently picked that constraint up. "ds" is a substring
 *     of "wrds": the /ds entry point loaded wrds-sge-enforcement (WRDS grid rules, irrelevant to a
 *     generic DS project) while /wrds — the intended audience — loaded nothing, because the wrds
 *     skill never calls the loader at all. Nothing failed; the wrong prose just arrived in the wrong
 *     prompt.
 *
 *     The fix was exact match, or entry starting with "<skill>-" so a workflow entry point also
 *     collected its phase skills' constraints.
 *
 *     THAT SECOND HALF IS GONE (2026-07-29). Reverse inheritance meant an entry point absorbed every
 *     constraint naming any phase in its family: 69% of /ds's load was rules for phases it never
 *     runs — /ds is brainstorm, and it was handed ds-data-pull-profile and ds-join-audits, including
 *     rules about touching data that its own hook-enforced Iron Law forbids. /writing carried 63%
 *     inherited, /dev 45%. A constraint now reaches only the skills it NAMES; family scope is opt-in
 *     via a `ds-*` glob.
 *
 *     This file therefore no longer mirrors check-all.py's `_applies`, and MUST NOT be "fixed" to.
 *     `_applies` matches a WORKFLOW ("should this check run in this project?") where family-prefix
 *     matching is correct; `skillMatches` matches a SKILL ("should this skill load this text?").
 *     Unifying them takes a writing project from 30 checks running to 4.
 *
 * Run:  bun test tests/load-constraints-applies-to.test.ts
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatter, skillMatches } from "../scripts/load-constraints.ts";

const ROOT = resolve(import.meta.dir, "..");

test("exact match and 'all'", () => {
  expect(skillMatches(["ds-plan"], "ds-plan")).toBe(true);
  expect(skillMatches(["all"], "whatever")).toBe(true);
  expect(skillMatches(["DS-Plan"], "ds-plan")).toBe(true); // case-insensitive
  expect(skillMatches(["writing-draft"], "ds-plan")).toBe(false);
  expect(skillMatches([], "ds")).toBe(false); // empty applies-to matches nothing
});

test("reverse inheritance is gone; family scope is opt-in via -*", () => {
  // An entry point no longer collects its phase skills' constraints.
  expect(skillMatches(["ds-implement"], "ds")).toBe(false);
  expect(skillMatches(["dev-review", "dev-verify"], "dev")).toBe(false);
  // ...and still not the other way around: a phase must not inherit a sibling's constraint.
  expect(skillMatches(["ds"], "ds-plan")).toBe(false);
  // Family scope covers the entry point AND every phase, but only when asked for.
  expect(skillMatches(["ds-*"], "ds")).toBe(true);
  expect(skillMatches(["ds-*"], "ds-implement")).toBe(true);
  expect(skillMatches(["ds-*"], "wrds")).toBe(false);
  expect(skillMatches(["ds-*"], "wrds-sge-enforcement")).toBe(false);
});

test("the substring regression: 'ds' must not match 'wrds'", () => {
  expect(skillMatches(["wrds"], "ds")).toBe(false);
  expect(skillMatches(["wrds-sge-enforcement"], "ds")).toBe(false);
  expect(skillMatches(["nohpc"], "hpc")).toBe(false);
  expect(skillMatches(["wrds"], "wrds")).toBe(true);
});

test("every shipped constraint reaches at least one loader-calling skill", () => {
  // A constraint nobody can load is dead prose — that is how hpc-slurm-enforcement.md and
  // wrds-sge-enforcement.md sat unreachable.
  const callers = new Set<string>();
  const readReached = new Set<string>();

  for (const d of readdirSync(join(ROOT, "skills"))) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, "skills", d, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    // Both extensions: the loader was ported to TypeScript on 2026-07-29 and the bang lines now read
    // `bun .../load-constraints.ts <skill>`. Matching only .py silently emptied the caller set,
    // making every constraint look unreachable — caught immediately after the retarget.
    for (const m of text.matchAll(/load-constraints\.(?:py|ts)\s+([a-z0-9-]+)/g)) callers.add(m[1]);

    // A skill may also deliver a constraint by naming its file directly — ds-delegate does this
    // deliberately, because auto-load reaches main chat but its analysis/engineering SUBAGENTS are
    // what need the rules, and the two roles need different subsets.
    //
    // The mention must be a DELIVERY, not a mention. A bare path regex exempted 27 files when only
    // 18 had a real Read directive; two were exempted solely by an illustrative list in
    // workflow-creator's own docs, which let a constraint retargeted to a retired skill stay green
    // while being genuinely dead. So the line must also carry `Read` or `CLAUDE_SKILL_DIR`.
    for (const line of text.split("\n")) {
      if (!line.includes("Read") && !line.includes("CLAUDE_SKILL_DIR")) continue;
      for (const m of line.matchAll(/references\/constraints\/([a-z0-9-]+)\.md/g)) readReached.add(m[1]);
    }
  }
  callers.delete("skill-name"); // the documentation placeholder in workflow-creator

  expect(callers.size).toBeGreaterThan(10);

  const cdir = join(ROOT, "references", "constraints");
  const orphans: string[] = [];
  for (const f of readdirSync(cdir).filter((n) => n.endsWith(".md")).sort()) {
    const stem = f.replace(/\.md$/, "");
    if (readReached.has(stem)) continue;
    const [meta] = parseFrontmatter(readFileSync(join(cdir, f), "utf8"));
    let appliesTo = meta["applies-to"] ?? [];
    if (typeof appliesTo === "string") appliesTo = [appliesTo];
    if (![...callers].some((s) => skillMatches(appliesTo as string[], s))) {
      orphans.push(`${f} (applies-to=${JSON.stringify(appliesTo)})`);
    }
  }
  expect(orphans).toEqual([]);
});
