// Suites that `bun test ./tests/` cannot score, run in their own process and checked by exit code.
//
// Two styles live in tests/: a file importing "bun:test" (or calling describe/test/it at top
// level), which `bun test` collects and counts, and a file that ASSERTS AT TOP LEVEL and signals
// through its exit code. Under `bun test` the second style registers zero tests, so its result is
// invisible in the "N pass / N fail" line every gate parses.
//
// scripts/check-tests.sh routed both correctly and nothing ever called it. This file is that routing
// inside the runner plugin-audit already gates. `tests/*.test.sh` is shell-suites.test.ts's job.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TESTS = dirname(import.meta.path);
const SELF = "standalone-suite-exit-codes.test.ts";

const jsSuites = readdirSync(TESTS)
  .filter((f) => /\.test\.(ts|mjs|js)$/.test(f) && f !== SELF)
  .sort();
const source = (f: string) => readFileSync(join(TESTS, f), "utf8");
// A file bun test collects is left to bun test; anything else is ours to run.
const collected = (f: string) => /from ["']bun:test["']|^\s*(describe|test|it)\(/m.test(source(f));
const standalone = jsSuites.filter((f) => !collected(f));

describe("suites bun test cannot score", () => {
  test("discovery found suites to run — an empty set is could-not-run, not a pass", () => {
    expect(jsSuites.length).toBeGreaterThan(0);
    expect(standalone.length).toBeGreaterThan(0);
  });

  // Success must be signalled by RETURNING. A top-level `process.exit(0)` truncates every
  // shared-process runner at that file: measured at e225afb, bun exited 0 after 12 of 27 files
  // with a failing suite among the 15 that never ran.
  test("no suite exits 0 at top level", () => {
    const offenders = jsSuites.filter((f) =>
      /^[ \t]*process\.exit\((FAIL \? 1 : )?0\)/m.test(source(f)),
    );
    expect(offenders).toEqual([]);
  });

  for (const f of standalone) {
    test(`bun ${f} exits 0`, () => {
      const r = spawnSync("bun", [join(TESTS, f)], { encoding: "utf8", timeout: 300_000 });
      expect(`${f} rc=${r.status}\n${r.stdout ?? ""}${r.stderr ?? ""}`).toContain(`${f} rc=0`);
    }, 300_000);
  }
});
