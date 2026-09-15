// The two wirings between the prose engine and run-constraints.py that went stale silently at v6.0.0,
// pinned so the next move is loud.
//
// Both defects were invisible at run time. A suppression entry that matches nothing does not throw
// — it just stops suppressing, and the finding it used to cover is reported twice. A computed
// engine path that misses does not throw either — the subprocess raised, a bare `except` swallowed
// it, and a SEVERITY="hard" constraint was filed under `passed`. pc-probe finds both across the
// repo; these two have their own tests because both are one-token edits away from returning.
import { describe, expect, test } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { PROSE_ENGINE_PREFIXES } from "../hooks/writing-prose-check.ts";

const REPO = dirname(import.meta.dir);

/** Every entry name `constraints/run-constraints.py` can put in its results, built the way it
 *  builds them: `constraints/<stem>` at :156 and `skills/<skill>/constraints/<stem>` at :213. */
function checkAllLabels(): string[] {
  const labels: string[] = [];
  for (const f of readdirSync(join(REPO, "constraints"))) {
    if (f.endsWith(".py") && f !== "run-constraints.py") labels.push(`constraints/${f.slice(0, -3)}`);
  }
  for (const skill of readdirSync(join(REPO, "skills"))) {
    const refs = join(REPO, "skills", skill, "constraints");
    if (!existsSync(refs)) continue;
    for (const f of readdirSync(refs)) {
      if (f.endsWith(".py")) labels.push(`skills/${skill}/constraints/${f.slice(0, -3)}`);
    }
  }
  return labels;
}

describe("PROSE_ENGINE_PREFIXES suppresses live check-all entries and only those", () => {
  const labels = checkAllLabels();

  test("check-all can emit some entries at all (guards the fixture, not the rule)", () => {
    expect(labels.length).toBeGreaterThan(10);
  });

  // The v6.0.0 regression exactly: "skills/writing-" matched nothing once the style guides moved
  // from skills/writing-{general,legal,econ}/references/ to skills/writing/references/, and
  // in 2026-09 the RULES moved again to skills/writing/constraints/ — the guides stayed put.
  for (const prefix of PROSE_ENGINE_PREFIXES) {
    test(`"${prefix}" still matches at least one entry check-all can emit`, () => {
      const hits = labels.filter((l) => l.startsWith(prefix));
      expect(hits).not.toEqual([]);
    });
  }

  // The other half of the same judgement: the four structural modules share a directory with the
  // three style guides, prose-audit.py does not own them, and a directory-wide prefix would silence
  // them without any error anywhere.
  const STRUCTURAL = [
    "skills/writing/constraints/writing-topic-sentences",
    "skills/writing/constraints/writing-anchored-numbers",
    "skills/writing/constraints/writing-outline-sync",
    "skills/writing/constraints/writing-shortjournal",
  ];
  for (const label of STRUCTURAL) {
    test(`the structural constraint ${label} is NOT suppressed`, () => {
      expect(labels).toContain(label);
      expect(PROSE_ENGINE_PREFIXES.some((p) => label.startsWith(p))).toBe(false);
    });
  }
});

describe("writing-no-bold-lead resolves the engine it delegates to", () => {
  // It carries no regex of its own: if PROSE_AUDIT does not resolve, the constraint cannot fire at
  // all. Asserted by importing the module and reading the path it actually computed, so a wrong
  // parents[N] fails here rather than passing quietly through check-all.
  const MODULE = join(REPO, "skills", "writing", "constraints", "writing-no-bold-lead.py");

  test("PROSE_AUDIT points at a file that exists", () => {
    const proc = Bun.spawnSync([
      "python3", "-c",
      "import importlib.util,sys;" +
      `spec=importlib.util.spec_from_file_location("nbl", ${JSON.stringify(MODULE)});` +
      "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(m.PROSE_AUDIT)",
    ]);
    const resolved = proc.stdout.toString().trim();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(resolved).toBe(join(REPO, "scripts", "prose-audit.py"));
    expect(existsSync(resolved)).toBe(true);
  });

  test("an unreachable engine raises rather than returning a clean pass", () => {
    // SEVERITY is "hard", so `except Exception: return []` reported "no bold leads found" for a
    // checker that never ran. run-constraints.py files a raised exception under `errors` instead.
    const proc = Bun.spawnSync([
      "python3", "-c",
      "import importlib.util,pathlib,sys,tempfile;" +
      `spec=importlib.util.spec_from_file_location("nbl", ${JSON.stringify(MODULE)});` +
      "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);" +
      "m.PROSE_AUDIT=pathlib.Path('/nonexistent/prose-audit.py');" +
      "d=tempfile.mkdtemp();dr=pathlib.Path(d)/'drafts';dr.mkdir();" +
      "(dr/'a.md').write_text('**Bold lead.** Body text follows here.\\n');" +
      "\ntry:\n m.check({'cwd': d})\nexcept Exception as e:\n print('RAISED'); sys.exit(0)\nprint('SILENT'); sys.exit(1)",
    ]);
    expect(proc.stdout.toString().trim(), proc.stderr.toString()).toBe("RAISED");
  });
});
