import { test, expect } from "bun:test";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = dirname(import.meta.dir);

// THE SUITE-COVERAGE CONTRACT. plugin-audit gates this repo's Python suites through two
// hand-written manifests -- `tests/script-suites.txt` (standalone PEP 723 scripts) and
// `tests/pytest-extra.txt` (pytest collections outside tests/). Both are lists someone has to
// remember to append to, and a suite missing from both runs in NO gate while reporting nothing,
// which is how an ungated suite rots: measured 2026-09-18, eight of the nine suites outside
// tests/ were declared and one -- external/anthropic-skills/.../check_bounding_boxes_test.py --
// was in neither, ten passing tests nobody ran.
//
// So the lists stop being trusted and start being checked: every Python suite outside tests/ is
// DERIVED from the tree and must be named by one manifest or declared not-gated with a reason.
// A suite added tomorrow is red the day it lands, not the day someone remembers.

const MANIFESTS = ["tests/script-suites.txt", "tests/pytest-extra.txt"];
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", "scratch", ".claude", "tests"]);

/** Submodule paths, read from .gitmodules. Another repo's suites are that repo's to gate. */
function submodulePaths(): Set<string> {
  const f = join(ROOT, ".gitmodules");
  if (!existsSync(f)) return new Set();
  return new Set(
    readFileSync(f, "utf8").split("\n")
      .map((l) => l.trim().match(/^path\s*=\s*(\S+)$/)?.[1])
      .filter((x): x is string => Boolean(x)),
  );
}

/** Every file under ROOT that pytest would treat as a suite, excluding tests/ itself.
 *  lstat, not stat: `skills/pdf` is a symlink INTO the anthropic-skills submodule, and following
 *  it walked the same upstream file twice under two paths. A link is not a second suite. */
function derivedSuites(): string[] {
  const submodules = submodulePaths();
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const abs = join(dir, e);
      const rel = relative(ROOT, abs);
      let st;
      try { st = lstatSync(abs); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e) || e.startsWith(".") || submodules.has(rel)) continue;
        walk(abs);
      } else if (/^test_.*\.py$/.test(e) || /_test\.py$/.test(e)) {
        found.push(rel);
      }
    }
  };
  walk(ROOT);
  return found.sort();
}

/** Paths a manifest names, plus paths it declares NOT gated (`# not-gated: <path> -- <reason>`). */
function manifestPaths(): { gated: Set<string>; exempt: Map<string, string> } {
  const gated = new Set<string>();
  const exempt = new Map<string, string>();
  for (const m of MANIFESTS) {
    const p = join(ROOT, m);
    // Fail CLOSED: a missing manifest is could-not-run, never an empty one.
    if (!existsSync(p)) throw new Error(`${m} does not exist; refusing to judge coverage against an unknown manifest`);
    for (const raw of readFileSync(p, "utf8").split("\n")) {
      const line = raw.trim();
      const ng = line.match(/^#\s*not-gated:\s*(\S+)\s*--\s*(.+)$/);
      if (ng) { exempt.set(ng[1], ng[2].trim()); continue; }
      if (!line || line.startsWith("#")) continue;
      gated.add(line);
    }
  }
  return { gated, exempt };
}

test("every python suite outside tests/ is gated or declared not-gated with a reason", () => {
  const suites = derivedSuites();
  // A derivation that found nothing is a broken walk, not a clean repo.
  expect(suites.length, "derived zero python suites outside tests/ -- the walk is broken").toBeGreaterThan(5);

  const { gated, exempt } = manifestPaths();
  const unaccounted = suites.filter((s) => !gated.has(s) && !exempt.has(s));
  expect(
    unaccounted,
    `these python suites are named by neither tests/script-suites.txt nor tests/pytest-extra.txt, ` +
      `so plugin-audit never runs them. Add each to the manifest that fits, or declare it with ` +
      `"# not-gated: <path> -- <reason>":\n  ${unaccounted.join("\n  ")}`,
  ).toEqual([]);
});

test("a manifest never names a path that has gone", () => {
  const { gated, exempt } = manifestPaths();
  const missing = [...gated, ...exempt.keys()].filter((p) => !existsSync(join(ROOT, p)));
  expect(missing, `manifest entries pointing at nothing: ${missing.join(", ")}`).toEqual([]);
});

test("every not-gated declaration carries a reason", () => {
  const { exempt } = manifestPaths();
  const empty = [...exempt.entries()].filter(([, why]) => why.length < 10).map(([p]) => p);
  expect(empty, `not-gated without a real reason: ${empty.join(", ")}`).toEqual([]);
});
