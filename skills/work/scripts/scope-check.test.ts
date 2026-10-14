import { test, expect, setDefaultTimeout } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

setDefaultTimeout(300_000);
const SCOPE = join(import.meta.dir, "scope-check.sh");

// A git project with a committed base, an approved plan beside it, and edits applied after the base.
function fixture(args: Record<string, unknown>, edits: Record<string, string>, planText?: string) {
  const d = mkdtempSync(join(tmpdir(), "scopecheck-"));
  const git = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8", timeout: 30_000 });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src/a.ts"), "export {}\n");
  git("add", "-A"); git("commit", "-qm", "base");
  const plan = join(d, "plan.md");
  writeFileSync(plan, planText ?? `# Plan\n<!-- work:dispatch ${JSON.stringify({ args: { projectDir: d, ...args } })} -->\n`);
  git("add", "plan.md"); git("commit", "-qm", "plan");
  for (const [f, c] of Object.entries(edits)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  return { d, plan };
}
const run = (d: string, plan: string, env: Record<string, string> = {}) => {
  const r = spawnSync("bash", [SCOPE, "--plan", plan, "--project-dir", d], { encoding: "utf8", timeout: 30_000, env: { ...process.env, ...env } });
  return { code: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const TASKS = { tasks: [{ id: "T1", writablePaths: ["src/a.ts", "lib"], refs: [] }] };

test("a stray edit outside every writablePath exits 1 and names the path", () => {
  const f = fixture(TASKS, { "src/a.ts": "export const x = 1\n", "docs/stray.md": "oops\n" });
  try {
    const r = run(f.d, f.plan);
    expect(r.code).toBe(1);
    expect(r.out).toContain("docs/stray.md");
    expect(r.out).not.toMatch(/outside.*src\/a\.ts/);
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

test("edits inside writablePaths (file and directory) exit 0 and count the paths examined", () => {
  const f = fixture(TASKS, { "src/a.ts": "export const x = 1\n", "lib/deep/b.ts": "export {}\n" });
  try {
    const r = run(f.d, f.plan);
    expect(r.code).toBe(0);
    expect(r.out).toContain("scope: 2 path(s) examined");
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

test("a path under scaffoldPaths passes", () => {
  const f = fixture({ ...TASKS, scaffoldPaths: ["tests/red.test.ts"] }, { "tests/red.test.ts": "x\n", "src/a.ts": "export const y = 2\n" });
  try {
    expect(run(f.d, f.plan).code).toBe(0);
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

test("an unreadable plan, a plan with no dispatch block, and a non-git project exit 2", () => {
  const f = fixture(TASKS, { "src/a.ts": "export const x = 1\n" });
  const nogit = mkdtempSync(join(tmpdir(), "scopecheck-ng-"));
  try {
    expect(run(f.d, join(f.d, "missing.md")).code).toBe(2);
    writeFileSync(join(f.d, "bare.md"), "# no block\n");
    expect(run(f.d, join(f.d, "bare.md")).code).toBe(2);
    expect(run(nogit, f.plan).code).toBe(2);
  } finally { rmSync(f.d, { recursive: true, force: true }); rmSync(nogit, { recursive: true, force: true }); }
});

test("WORK_RUN_BASELINE scopes to this run: an edit already in the tree at dispatch is not a stray", () => {
  const f = fixture(TASKS, { "docs/prior-wip.md": "before the run\n" });
  try {
    const snap = spawnSync("bash", [join(import.meta.dir, "tree-snapshot.sh"), f.d], { encoding: "utf8", timeout: 30_000 }).stdout.trim();
    expect(snap).toMatch(/^[0-9a-f]{40,64}$/);
    expect(run(f.d, f.plan).code).toBe(1);
    const r = run(f.d, f.plan, { WORK_RUN_BASELINE: snap });
    expect(r.code).toBe(0);
    writeFileSync(join(f.d, "docs/new-stray.md"), "x\n");
    const r2 = run(f.d, f.plan, { WORK_RUN_BASELINE: snap });
    expect(r2.code).toBe(1);
    expect(r2.out).toContain("docs/new-stray.md");
    expect(r2.out).not.toContain("prior-wip");
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

// Deletions and rename sources are changes too: under a baseline they used to vanish from the changed set.
function baselined(setup: Record<string, string>) {
  const f = fixture({ tasks: [{ id: "T1", writablePaths: ["src", "lib"], refs: [] }] }, setup);
  const git = (...a: string[]) => spawnSync("git", ["-C", f.d, ...a], { encoding: "utf8", timeout: 30_000 });
  git("add", "-A"); git("commit", "-qm", "files");
  const snap = spawnSync("bash", [join(import.meta.dir, "tree-snapshot.sh"), f.d], { encoding: "utf8", timeout: 30_000 }).stdout.trim();
  return { ...f, snap, git };
}

test("under a baseline an out-of-scope deletion exits 1 and names the path", () => {
  const f = baselined({ "other/important.ts": "export {}\n" });
  try {
    rmSync(join(f.d, "other/important.ts"));
    const r = run(f.d, f.plan, { WORK_RUN_BASELINE: f.snap });
    expect(r.code).toBe(1);
    expect(r.out).toContain("other/important.ts");
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

test("under a baseline an out-of-scope rename source exits 1 and names the old path", () => {
  const f = baselined({ "other/old.ts": "export const keep = 'a long enough body to be a rename'\n" });
  try {
    f.git("mv", "other/old.ts", "src/new.ts");
    const r = run(f.d, f.plan, { WORK_RUN_BASELINE: f.snap });
    expect(r.code).toBe(1);
    expect(r.out).toContain("other/old.ts");
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

test("under a baseline an in-scope deletion exits 0 and is counted", () => {
  const f = baselined({ "src/gone.ts": "export {}\n" });
  try {
    rmSync(join(f.d, "src/gone.ts"));
    const r = run(f.d, f.plan, { WORK_RUN_BASELINE: f.snap });
    expect(r.code).toBe(0);
    expect(r.out).toContain("scope: 1 path(s) examined");
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});

test("scope examines 200 changed paths in one containment process", () => {
  const edits: Record<string, string> = {};
  for (let i = 0; i < 200; i++) edits[`src/gen/f${i}.ts`] = `export const n = ${i}\n`;
  const f = fixture({ tasks: [{ id: "T1", writablePaths: ["src"], refs: [] }] }, edits);
  try {
    const t = Date.now();
    const r = run(f.d, f.plan);
    console.log(`scope 200 paths: ${Date.now() - t} ms`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("scope: 200 path(s) examined");
  } finally { rmSync(f.d, { recursive: true, force: true }); }
});
