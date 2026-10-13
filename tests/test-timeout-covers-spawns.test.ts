import { test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { scanTestCosts, unresolvedCauses } from "./lib/test-timeout-scan.ts";
import { useTmp } from "./helpers/tmp.ts";

const mkTmp = useTmp();

// A test that waits on a child for longer than bun lets the test run dies at bun's timeout with a
// TypeError from the half-finished result, hiding what the child did (farm-chart-style, 2026-10-13,
// under suite load). Every spawn already carries its own timeout (sync-spawn-timeout.test.ts), so
// the test's timeout must cover the spawn timeouts it can reach: bun's 5 s default, the file's
// `setDefaultTimeout`, or the test's own third argument. Literal timeouts, numeric constants (file
// level or imported from a relative file), helper-parameter defaults and file-level options objects
// are summed; one call site counts once, so a loop is a lower bound. A sync spawn with no timeout
// key at all stays unresolved (and `unresolvedCauses` says so); see the last test.

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
    for (const t of scanTestCosts(src, { dir: dirname(join(ROOT, f)) })) {
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

test("the scanner resolves an imported constant, a helper-parameter default and a spread file-level options object", () => {
  const dir = mkTmp("tts-");
  writeFileSync(join(dir, "consts.ts"), "export const SLOW = 90_000\nexport const PAIR = 2 * 15_000\nconst HIDDEN = 7\n");
  const src = [
    "import { test } from 'bun:test'",
    "import { SLOW, PAIR as TWO } from './consts.ts'",
    "const OPTS = { timeout: 25_000, encoding: 'utf8' }",
    "function run(a, timeout = 40_000) { return spawnSync('x', a, { timeout }) }",
    "const go = (a, ms = 30_000) => spawnSync('y', a, { timeout: ms })",
    "test('imp', () => { spawnSync('x', [], { timeout: SLOW }); spawnSync('x', [], { timeout: TWO }) }, 300_000)",
    "test('def', () => { run([]); go([]) }, 300_000)",
    "test('call-site literal beats the default', () => { run([], 5_000); go([], 6_000) }, 300_000)",
    "test('spread', () => { spawnSync('x', [], { ...OPTS, cwd: '.' }); spawnSync('x', [], OPTS) }, 300_000)",
  ].join("\n");
  expect(scanTestCosts(src, { dir }).map((t) => [t.name, t.spawnMs, t.unresolved])).toEqual([
    ["imp", 120_000, 0],
    ["def", 70_000, 0],
    ["call-site literal beats the default", 11_000, 0],
    ["spread", 50_000, 0],
  ]);
});

test("the scanner leaves the undecidable unresolved, names why, and does not charge an async spawn", () => {
  const src = [
    "import { test } from 'bun:test'",
    "import { SLOW } from './missing.ts'",
    "const OPTS = { encoding: 'utf8' }",
    "test('env', () => { spawnSync('x', [], { timeout: Number(process.env.T) }) })",
    "test('lost import', () => { spawnSync('x', [], { timeout: SLOW }) })",
    "test('param', () => { run([]) })",
    "test('param, caller computes', () => { run([], Number(process.env.T)) })",
    "function run(a, ms) { return spawnSync('x', a, { timeout: ms }) }",
    "test('bare sync', () => { spawnSync('x', ['a']) })",
    "test('no key', () => { spawnSync('x', [], OPTS) })",
    "test('async', async () => { await Bun.spawn(['x'], { stdout: 'pipe' }).exited })",
  ].join("\n");
  const costs = scanTestCosts(src, { dir: tmpdir() });
  expect(costs.map((t) => [t.name, t.spawnMs, t.unresolved])).toEqual([
    ["env", 0, 1], ["lost import", 0, 1], ["param", 0, 1], ["param, caller computes", 0, 1], ["bare sync", 0, 1], ["no key", 0, 1], ["async", 0, 0],
  ]);
  expect(costs.map((t) => unresolvedCauses(t))).toEqual([
    ["computed"], ["unresolved-identifier"], ["unresolved-identifier"], ["unresolved-identifier"], ["sync-no-timeout"], ["sync-no-timeout"], [],
  ]);
});
