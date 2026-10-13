import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { scanTestCosts } from "./lib/test-timeout-scan.ts";

// A test that waits on a child for longer than bun lets the test run dies at bun's timeout with a
// TypeError from the half-finished result, hiding what the child did (farm-chart-style, 2026-10-13,
// under suite load). Every spawn already carries its own timeout (sync-spawn-timeout.test.ts), so
// the test's timeout must cover the spawn timeouts it can reach: bun's 5 s default, the file's
// `setDefaultTimeout`, or the test's own third argument. Only literal timeouts (and file-level
// numeric constants) are summed; one call site counts once, so a loop is a lower bound.

const ROOT = dirname(import.meta.dir);

function suiteFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "tests", "skills"],
                      { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ls-files exited ${r.status}: ${r.stderr}`);
  return r.stdout.split("\n").filter((f) => /\.test\.(ts|mjs|js)$/.test(f) && !f.includes("/fixtures/"));
}

test("every test's timeout covers the spawn timeouts it reaches", () => {
  const short: string[] = [];
  let spawning = 0;
  for (const f of suiteFiles()) {
    const src = readFileSync(join(ROOT, f), "utf8");
    if (!/from\s+["']bun:test["']/.test(src)) continue;
    for (const t of scanTestCosts(src)) {
      if (t.spawnMs > 0) spawning++;
      if (t.spawnMs > t.effectiveMs) {
        short.push(`${f}:${t.line} ${t.source} ${t.effectiveMs / 1000}s < spawns ${t.spawnMs / 1000}s: ${t.name}`);
      }
    }
  }
  // Not vacuous: the suite held about 1,100 spawning tests when this was written.
  expect(spawning).toBeGreaterThan(800);
  expect(short).toEqual([]);
}, 30_000);

test("the scanner reads per-test, file-default and bun-default timeouts and sums helper spawns", () => {
  const src = [
    "import { test, setDefaultTimeout } from 'bun:test'",
    "const WAIT = 40_000",
    "setDefaultTimeout(60_000)",
    "function run() { return spawnSync('x', [], { timeout: 60_000 }) }",
    "const quick = () => spawnSync('y', [], { timeout: WAIT })",
    "test('a', () => { run(); run(); quick() })",
    "test('b', () => { spawnSync('z', [], { timeout: 10_000 }) }, 20_000)",
    "test('c', () => { spawnSync('z', [], { timeout: 10_000 }) }, { timeout: 30_000 })",
    "test('d', () => { const s = \"spawnSync('q', [], { timeout: 99_000 })\" })",
  ].join("\n");
  expect(scanTestCosts(src).map((t) => [t.name, t.source, t.effectiveMs, t.spawnMs])).toEqual([
    ["a", "file", 60_000, 160_000],
    ["b", "test", 20_000, 10_000],
    ["c", "test", 30_000, 10_000],
    ["d", "file", 60_000, 0],
  ]);
  const bare = "test('e', () => { spawnSync('z', [], { timeout: 10_000 }) })";
  expect(scanTestCosts(bare).map((t) => [t.source, t.effectiveMs, t.spawnMs])).toEqual([["bun", 5_000, 10_000]]);
});
