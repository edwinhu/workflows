/*
 * Tests for scripts/load-constraints.ts scoping and shipped-constraint reachability.
 *
 * A constraint is reachable only when a loader-calling skill names it, a skill directly reads it, or
 * the closed DS disposition fixture proves that a task brief delivers an aggregate whose index names
 * that exact atomic file. Broad exemptions are intentionally unsupported.
 *
 * Run: bun test tests/load-constraints-applies-to.test.ts
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatter, skillMatches } from "../scripts/load-constraints.ts";

const ROOT = resolve(import.meta.dir, "..");
const CONSTRAINTS = join(ROOT, "references", "constraints");
const FIXTURE = join(ROOT, "tests", "fixtures", "constraint-dispositions.json");

const expectedDirectAggregate = [
  "ds-determinism.md",
  "ds-deviation-rules-analysis.md",
  "ds-error-handling.md",
  "ds-idempotency.md",
  "ds-join-audits.md",
  "ds-p-hacking-prevention.md",
  "ds-robustness-checks.md",
  "ds-sample-selection.md",
  "ds-schema-contracts.md",
  "ds-standard-error-spec.md",
  "ds-statistical-validity.md",
  "ds-table-figure-pairing.md",
  "ds-visualization-integrity.md",
].sort();

const expectedAggregates = new Set([
  "skills/ds/references/ds-analysis-constraints.md",
  "skills/ds/references/ds-engineering-constraints.md",
  "skills/ds/references/ds-common-conventions.md",
]);
const expectedTaskBriefs = ["skills/ds/SKILL.md"];

type Disposition = {
  constraint: string;
  disposition: "direct-aggregate";
  aggregate: string;
  taskBriefs: string[];
};

function readDispositions(): Disposition[] {
  expect(existsSync(FIXTURE), "closed loader-orphan disposition fixture must exist").toBe(true);
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Disposition[];
}

/**
 * A repo-root constraint is reached when a file under `skills/` names it by its plugin-root path.
 * The craft-era skills read their constraints directly; nothing calls the loader from a SKILL.md,
 * so caller-name scanning would report every constraint as an orphan.
 */
function collectDirectReachability() {
  const readReached = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(md|ts|js|sh|py)$/.test(entry.name)) continue;
      let text: string;
      try { text = readFileSync(p, "utf8"); } catch { continue; }
      for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/references\/constraints\/([a-z0-9-]+)\.md/g)) {
        readReached.add(m[1]);
      }
    }
  };
  walk(join(ROOT, "skills"));
  return { readReached };
}

test("exact match and 'all'", () => {
  expect(skillMatches(["ds-plan"], "ds-plan")).toBe(true);
  expect(skillMatches(["all"], "whatever")).toBe(true);
  expect(skillMatches(["DS-Plan"], "ds-plan")).toBe(true);
  expect(skillMatches(["writing-draft"], "ds-plan")).toBe(false);
  expect(skillMatches([], "ds")).toBe(false);
});

test("reverse inheritance is gone; family scope is opt-in via -*", () => {
  expect(skillMatches(["ds-implement"], "ds")).toBe(false);
  expect(skillMatches(["dev-verify", "dev-accept"], "dev")).toBe(false);
  expect(skillMatches(["ds"], "ds-plan")).toBe(false);
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

test("the closed orphan disposition is exact, current, and delivered through named authority", () => {
  const entries = readDispositions();
  expect(entries.map((entry) => entry.constraint).sort()).toEqual(expectedDirectAggregate);
  expect(new Set(entries.map((entry) => entry.constraint)).size).toBe(entries.length);

  for (const entry of entries) {
    expect(Object.keys(entry).sort()).toEqual(["aggregate", "constraint", "disposition", "taskBriefs"]);
    expect(entry.disposition).toBe("direct-aggregate");
    expect(expectedAggregates.has(entry.aggregate)).toBe(true);
    expect(entry.taskBriefs).toEqual(expectedTaskBriefs);

    const atomicPath = join(CONSTRAINTS, entry.constraint);
    const aggregatePath = join(ROOT, entry.aggregate);
    expect(existsSync(atomicPath), `${entry.constraint} must remain current`).toBe(true);
    expect(existsSync(aggregatePath), `${entry.aggregate} must exist`).toBe(true);
    expect(readFileSync(aggregatePath, "utf8")).toContain(`constraints/${entry.constraint}`);

    for (const taskBrief of entry.taskBriefs) {
      const taskBriefPath = join(ROOT, taskBrief);
      expect(existsSync(taskBriefPath), `${taskBrief} must exist`).toBe(true);
      expect(readFileSync(taskBriefPath, "utf8")).toContain(entry.aggregate);
    }
  }
});

test("obsolete creator constraints are deleted", () => {
  expect(existsSync(join(CONSTRAINTS, "atomic-constraints.md"))).toBe(false);
  expect(existsSync(join(CONSTRAINTS, "auto-loader-usage.md"))).toBe(false);
});

test("every shipped constraint reaches a loader-calling skill or exact aggregate authority", () => {
  const { readReached } = collectDirectReachability();
  expect(readReached.size).toBeGreaterThan(10);
  const aggregateReached = new Set(readDispositions().map((entry) => entry.constraint.replace(/\.md$/, "")));

  const orphans: string[] = [];
  for (const f of readdirSync(CONSTRAINTS).filter((name) => name.endsWith(".md")).sort()) {
    const stem = f.replace(/\.md$/, "");
    if (readReached.has(stem) || aggregateReached.has(stem)) continue;
    const [meta] = parseFrontmatter(readFileSync(join(CONSTRAINTS, f), "utf8"));
    let appliesTo = meta["applies-to"] ?? [];
    if (typeof appliesTo === "string") appliesTo = [appliesTo];
    if (![...callers].some((skill) => skillMatches(appliesTo as string[], skill))) {
      orphans.push(`${f} (applies-to=${JSON.stringify(appliesTo)})`);
    }
  }
  expect(orphans).toEqual([]);
});
