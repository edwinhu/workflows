// Every `*.test.*` file that hand-rolls its own assertions must be able to FAIL `bun test`.
//
// THE DEFECT THIS EXISTS FOR, measured 2026-08-27: four files in `tests/` print their own
// `N passed, M failed` line and `process.exit(1)` on failure, but register no bun `test()` block.
// `bun test` sees a file with zero tests, ignores its exit code, and reports success. With two
// genuine failures live in `tests/writing-prose-check.test.mjs`, `bun test` exited **0** — and its
// summary line was the harness's own output being mistaken for bun's tally. 293 assertions across
// agent-contract (232), writing-prose-check (33), overflow-check (20) and typst-convention-guard
// (8) could not fail the gate.
//
// The harnesses are NOT rewritten into bun tests: each is also a standalone script with a
// documented `bun tests/<file>` invocation, and porting 293 assertions to change nothing but the
// runner is churn with a real chance of dropping one. Instead each is SPAWNED here, once, and its
// exit code is the assertion — the same "run it and read the exit code" rule this repo applies to
// every other mechanical gate.
//
// Discovery is dynamic ON PURPOSE. A hard-coded list of four would not cover the fifth, and the
// fifth is exactly the one nobody would remember to add.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = import.meta.dir;
const REPO = join(TESTS_DIR, "..");

/** A file that registers a bun test/it/describe is run BY bun and needs nothing from this file. */
const registersBunTests = (src: string): boolean =>
  /^\s*(?:await\s+)?(?:test|it|describe)\s*[.(]/m.test(src) ||
  /\b(?:test|it|describe)\s*\(\s*["'`]/.test(src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n"));

/** Self-reporting harnesses: named like a test, but invisible to the runner. */
function selfReporting(): string[] {
  return readdirSync(TESTS_DIR)
    .filter(f => /\.test\.(mjs|cjs|js|ts)$/.test(f))
    .filter(f => f !== "self-reporting-harnesses.test.ts")
    .filter(f => !registersBunTests(readFileSync(join(TESTS_DIR, f), "utf8")))
    .sort();
}

const harnesses = selfReporting();

describe("self-reporting harnesses can fail the gate", () => {
  test("the discovery finds the harnesses it was written for", () => {
    // If this list empties because the files were ported to bun tests, that is a good outcome —
    // delete this file then. It emptying for any other reason means discovery broke.
    expect(harnesses.length).toBeGreaterThan(0);
  });

  for (const file of harnesses) {
    test(`${file} exits 0`, () => {
      const r = Bun.spawnSync(["bun", join(TESTS_DIR, file)], {
        cwd: REPO,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });
      const out = `${r.stdout.toString()}${r.stderr.toString()}`.trim();
      // The exit code is the verdict; the output is here so a failure is readable without a re-run.
      expect(`${file} exit ${r.exitCode}\n${out}`).toBe(`${file} exit 0\n${out}`);
    }, 300_000);
  }
});
