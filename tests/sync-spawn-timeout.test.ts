import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { findSyncCalls, hasTimeout } from "./lib/sync-spawn-scan.ts";

// A synchronous child-process call blocks the test worker's event loop, so bun's per-test timeout
// cannot fire while it waits: once in nine parallel runs a `bun` child of converge-check.test.ts
// never returned and the worker spun for 18 minutes. Every such call in the suite carries its own
// `timeout`, which returns even when a grandchild still holds the pipe (measured 2026-10-02).

const ROOT = dirname(import.meta.dir);

function suiteFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "tests", "skills/work"],
                      { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ls-files exited ${r.status}: ${r.stderr}`);
  return r.stdout.split("\n").filter((f) =>
    /\.(ts|mjs|js|cjs)$/.test(f)
    && !f.includes("/fixtures/")
    && (f.startsWith("tests/") || /\.test\.(ts|mjs|js|cjs)$/.test(f)));
}

test("every synchronous spawn in the suite carries a timeout", () => {
  const unbounded: string[] = [];
  let seen = 0;
  for (const f of suiteFiles()) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const c of findSyncCalls(src)) {
      seen++;
      if (!hasTimeout(c)) unbounded.push(`${f}:${c.line} ${c.fn}`);
    }
  }
  // Not vacuous: the suite held 204 such calls when this was written.
  expect(seen).toBeGreaterThan(150);
  expect(unbounded).toEqual([]);
});

test("the scanner flags an unbounded call and ignores strings and comments", () => {
  const src = [
    "const a = spawnSync('bun', ['x'], { encoding: 'utf8' })",
    "const b = execFileSync('git', ['log'], { timeout: 5_000 })",
    "// spawnSync('in', ['a comment'])",
    "const s = `execSync(${'nested'})`",
    "const c = Bun.spawnSync(['ls'])",
  ].join("\n");
  const calls = findSyncCalls(src);
  expect(calls.map((c) => [c.fn, c.line, hasTimeout(c)])).toEqual([
    ["spawnSync", 1, false],
    ["execFileSync", 2, true],
    ["Bun.spawnSync", 5, false],
  ]);
});
