import { test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { lateDefaultTimeout, scanTestCosts, unresolvedCauses } from "./lib/test-timeout-scan.ts";
import { useTmp } from "./helpers/tmp.ts";

const mkTmp = useTmp();

// A test that waits on a child for longer than bun lets the test run dies at bun's timeout with a
// TypeError from the half-finished result, hiding what the child did (farm-chart-style, 2026-10-13,
// under suite load). Every spawn already carries its own timeout (sync-spawn-timeout.test.ts), so
// the test's timeout must cover the spawn timeouts it can reach: bun's 5 s default, the file's
// `setDefaultTimeout`, or the test's own third argument. Literal timeouts, numeric constants (file
// level or imported from a relative file), helper-parameter defaults and file-level options objects
// are summed; a spawn in a `for` / `for-of` loop with a literal trip count is multiplied by it, any other
// loop counts once and is named `loop-unknown-count`; `test.each` bodies are read once per row. A sync
// spawn with no timeout key at all stays unresolved (and `unresolvedCauses` says so).

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

test("a spawn inside a loop with a literal trip count is multiplied by it", () => {
  const src = [
    "import { test } from 'bun:test'",
    "const NAMES = ['p', 'q']",
    "function run() { return spawnSync('x', [], { timeout: 2_000 }) }",
    "function inner() { for (let k = 0; k < 3; k++) { spawnSync('y', [], { timeout: 1_000 }) } }",
    "test('for', () => { for (let i = 0; i < 4; i++) spawnSync('x', [], { timeout: 10_000 }) }, 300_000)",
    "test('for <=, step', () => { for (let i = 1; i <= 6; i += 2) { spawnSync('x', [], { timeout: 1_000 }) } }, 300_000)",
    "test('for-of literal', () => { for (const a of ['a', 'b', 'c']) { spawnSync('x', [a], { timeout: 5_000 }) } }, 300_000)",
    "test('for-of const array', () => { for (const n of NAMES) { spawnSync('x', [n], { timeout: 7_000 }) } }, 300_000)",
    "test('nested', () => { for (let i = 0; i < 3; i++) { for (const b of [1, 2]) { spawnSync('x', [], { timeout: 1_000 }) } } }, 300_000)",
    "test('helper in loop', () => { for (let i = 0; i < 5; i++) { run() } }, 300_000)",
    "test('loop in helper, called twice', () => { inner(); inner() }, 300_000)",
    "test('loop outside the spawn', () => { for (let i = 0; i < 9; i++) { void i } spawnSync('x', [], { timeout: 3_000 }) }, 300_000)",
  ].join("\n");
  expect(scanTestCosts(src).map((t) => [t.name, t.spawnMs, t.unresolved])).toEqual([
    ["for", 40_000, 0],
    ["for <=, step", 3_000, 0],
    ["for-of literal", 15_000, 0],
    ["for-of const array", 14_000, 0],
    ["nested", 6_000, 0],
    ["helper in loop", 10_000, 0],
    ["loop in helper, called twice", 6_000, 0],
    ["loop outside the spawn", 3_000, 0],
  ]);
});

test("a loop with an unknown trip count counts once and is named", () => {
  const src = [
    "import { test } from 'bun:test'",
    "function run() { return spawnSync('x', [], { timeout: 2_000 }) }",
    "test('for-of variable', () => { for (const a of files) { spawnSync('x', [a], { timeout: 5_000 }) } })",
    "test('for-of spread', () => { for (const a of [...more, 1]) { spawnSync('x', [a], { timeout: 5_000 }) } })",
    "test('while', () => { while (more()) { spawnSync('x', [], { timeout: 5_000 }) } })",
    "test('bound is a call', () => { for (let i = 0; i < n(); i++) { spawnSync('x', [], { timeout: 5_000 }) } })",
    "test('helper in unknown loop', () => { for (const a of files) { run() } })",
    "test('unknown loop around an async spawn', () => { for (const a of files) { Bun.spawn(['x']) } })",
  ].join("\n");
  const costs = scanTestCosts(src);
  expect(costs.map((t) => [t.name, t.spawnMs, t.unresolved])).toEqual([
    ["for-of variable", 5_000, 1], ["for-of spread", 5_000, 1], ["while", 5_000, 1], ["bound is a call", 5_000, 1],
    ["helper in unknown loop", 2_000, 1], ["unknown loop around an async spawn", 0, 0],
  ]);
  expect(costs.map((t) => unresolvedCauses(t))).toEqual([
    ["loop-unknown-count"], ["loop-unknown-count"], ["loop-unknown-count"], ["loop-unknown-count"], ["loop-unknown-count"], [],
  ]);
});

test("test.each and describe.each are read, each row invocation against its own timeout", () => {
  const src = [
    "import { test, it, describe, setDefaultTimeout } from 'bun:test'",
    "const ROWS = [[1], [2], [3]]",
    "test.each([[1], [2]])('per-test %i', (n) => { spawnSync('x', [], { timeout: 10_000 }) }, 20_000)",
    "test.each(ROWS)('file default', (n) => { spawnSync('x', [], { timeout: 10_000 }); spawnSync('y', [], { timeout: 5_000 }) })",
    "it.each(['a', 'b'])('bun default %s', (s) => { spawnSync('x', [], { timeout: 10_000 }) })",
    "test.each([1, 2])('loop in body', (n) => { for (let i = 0; i < 3; i++) spawnSync('x', [], { timeout: 1_000 }) }, 10_000)",
    "test.each([1])('unresolved', (n) => { spawnSync('x', [], { timeout: n * 1000 }) })",
    "describe.each([['a'], ['b']])('suite %s', (s) => {",
    "  test('inner', () => { spawnSync('x', [], { timeout: 8_000 }) })",
    "  test('inner, own timeout', () => { spawnSync('x', [], { timeout: 8_000 }) }, 30_000)",
    "})",
  ].join("\n");
  const costs = scanTestCosts(src);
  expect(costs.map((t) => [t.name, t.source, t.effectiveMs, t.spawnMs, t.unresolved])).toEqual([
    ["per-test %i", "test", 20_000, 10_000, 0],
    ["file default", "bun", 5_000, 15_000, 0],
    ["bun default %s", "bun", 5_000, 10_000, 0],
    ["loop in body", "test", 10_000, 3_000, 0],
    ["unresolved", "bun", 5_000, 0, 1],
    ["inner", "bun", 5_000, 8_000, 0],
    ["inner, own timeout", "test", 30_000, 8_000, 0],
  ]);
  const withDefault = "setDefaultTimeout(60_000)\ntest.each([1, 2])('d', () => { spawnSync('x', [], { timeout: 50_000 }) })";
  expect(scanTestCosts(withDefault).map((t) => [t.source, t.effectiveMs, t.spawnMs])).toEqual([["file", 60_000, 50_000]]);
});

// bun applies setDefaultTimeout only to tests registered after the call; an earlier test keeps the 5 s default.
test("setDefaultTimeout precedes the first test in every file, in both repos", () => {
  const late = (src: string) => lateDefaultTimeout(src);
  expect(late("import { test, setDefaultTimeout } from 'bun:test'\nsetDefaultTimeout(9)\ntest('a', () => {})")).toBeNull();
  expect(late("test('a', () => {})\n// test('b'\nsetDefaultTimeout(9)\ntest('c', () => {})")).toBe(3);
  expect(late("describe('d', () => { test('a', () => {}) })\nsetDefaultTimeout(9)")).toBe(2);
  expect(late("test('a', () => {})")).toBeNull();

  const roots = [ROOT, process.env.TEACHING_ROOT ?? join(dirname(ROOT), "teaching")];
  const bad: string[] = [];
  for (const root of roots) {
    const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.test.ts"],
                        { cwd: root, encoding: "utf8", timeout: 30_000 });
    if (r.status !== 0) continue;
    for (const f of r.stdout.split("\n").filter((x) => x && !x.includes("/fixtures/"))) {
      const n = lateDefaultTimeout(readFileSync(join(root, f), "utf8"));
      if (n !== null) bad.push(`${root}/${f}:${n}`);
    }
  }
  expect(bad).toEqual([]);
}, 70_000);
