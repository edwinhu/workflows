import { test, expect, setDefaultTimeout } from "bun:test";

setDefaultTimeout(400_000);
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CHECK = join(import.meta.dir, "check.sh");
// Omitting --plan is a refusal; the helper opts out with --no-plan unless the test names --plan itself.
const runRaw = (...a: string[]) => {
  const r = spawnSync("bash", [CHECK, ...a], { timeout: 120_000, encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
// Each of --plan/--lint-cmd/--build-cmd is required or declined, so the helper declines the ones a test does not exercise.
const run = (...a: string[]) => runRaw(...[
  ...a,
  ...(a.includes("--plan") || a.includes("--no-plan") ? [] : ["--no-plan"]),
  ...(a.includes("--lint-cmd") || a.includes("--no-lint-cmd") ? [] : ["--no-lint-cmd"]),
  ...(a.includes("--build-cmd") || a.includes("--no-build-cmd") ? [] : ["--no-build-cmd"]),
]);
const proj = () => mkdtempSync(join(tmpdir(), "devcheck-"));
// A test command that ran tests says how many; the tests leg counts them (work/scripts/leg-counts.sh),
// so a stand-in for a passing or failing suite prints a runner summary rather than being `true`/`false`.
const PASS = "echo 'Ran 1 test across 1 file.'";
const FAIL = `${PASS}; false`;

test("every leg reports, and none short-circuits the ones after it", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", FAIL, "--lint-cmd", "true", "--build-cmd", "true");
    expect(r.code).toBe(1);
    // The failing leg is FIRST; lint and build must still have run and said so.
    expect(r.out).toContain("leg tests exit=1");
    expect(r.out).toContain("leg lint exit=0");
    expect(r.out).toContain("leg build exit=0");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("all declared legs passing is exit 0", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", PASS, "--lint-cmd", "true", "--build-cmd", "true");
    expect(r.code).toBe(0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The defect this whole entry-point rule exists to prevent: a gate that ran nothing and
// reported clean. An undeclared leg is visible; ALL of them undeclared is a refusal.
test("declaring nothing is exit 2, never a clean pass", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--test-cmd is required");
    expect(r.out).toContain("declined");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// A suite that never runs must not read as a pass: lint and build are optional, the tests leg is not.
test("an empty or omitted --test-cmd is exit 2 even when lint is declared and passes", () => {
  const d = proj();
  try {
    for (const args of [["--lint-cmd", "true"], ["--test-cmd", "", "--lint-cmd", "true"]]) {
      const r = run("--project-dir", d, ...args);
      expect(r.code).toBe(2);
      expect(r.err).toContain("--test-cmd is required");
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a declined leg passes and says so, so it cannot be mistaken for absent", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", PASS);
    expect(r.code).toBe(0);
    expect(r.out).toContain("leg build exit=0 (declined)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a bad project dir and an unknown flag are both refusals", () => {
  expect(run("--project-dir", "/nope/nope", "--test-cmd", PASS).code).toBe(2);
  expect(run("--project-dir", ".", "--wat").code).toBe(2);
});

// The command runs IN the project, not wherever the gate was invoked from.
test("a leg runs inside --project-dir", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", `test "$(pwd -P)" = "$(cd ${d} && pwd -P)" && ${PASS}`);
    expect(r.code).toBe(0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// diff-scan (checks/dev/constraints/, reached through the dev-gate leg) reads only the lines a change adds.
// Patterns are assembled at runtime so this file does not itself trip the scan when the dev gate runs over this repo.
const ONLY = ["it", "only"].join(".");
const KEY = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
function gitProj(files: Record<string, string>, after: Record<string, string>) {
  const d = proj();
  const git = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { timeout: 30_000, encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  git("add", "-A"); git("commit", "-qm", "base", "--allow-empty");
  for (const [f, c] of Object.entries(after)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  return d;
}

test("scan: an added focused test fails the gate; the same line committed before does not", () => {
  const d = gitProj({ "tests/a.test.ts": `${ONLY}('x', () => {})\n` }, { "tests/a.test.ts": `${ONLY}('x', () => {})\nit('y', () => {})\n` });
  try {
    const clean = run("--project-dir", d, "--test-cmd", PASS);
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("leg dev-gate exit=0");
    writeFileSync(join(d, "tests/b.test.ts"), `${ONLY}('z', () => {})\n`);
    const r = run("--project-dir", d, "--test-cmd", PASS);
    expect(r.code).toBe(1);
    expect(r.out).toContain("leg dev-gate exit=1");
    expect(r.out).toContain("tests/b.test.ts:1: focused-or-skipped-test");
    expect(r.out).not.toContain("tests/a.test.ts:1");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// git ends a `+++ b/<name>` header with a tab when the name holds a space; a header read verbatim names no file given.
test("scan: a focused test added to a tracked file whose name has a space fails the gate", () => {
  const d = gitProj({ "tests/a b.test.ts": "it('x', () => {})\n" }, { "tests/a b.test.ts": `it('x', () => {})\n${ONLY}('y', () => {})\n` });
  try {
    const r = run("--project-dir", d, "--test-cmd", PASS);
    expect(r.code).toBe(1);
    expect(r.out).toContain("leg dev-gate exit=1");
    expect(r.out).toContain("tests/a b.test.ts:2: focused-or-skipped-test");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("scan: TLS off and a private key in added source lines fail; fixtures/ and 'scan: allow' are exempt", () => {
  const d = gitProj({ "src/a.ts": "export {}\n" }, {
    "src/a.ts": "export {}\nconst agent = { rejectUnauthorized: false }\n",
    "src/k.pem": `${KEY}\n`,
    "tests/fixtures/x.ts": "const o = { rejectUnauthorized: false }\n",
    "src/ok.py": "requests.get(u, verify=False)  # scan: allow\n",
  });
  try {
    const r = run("--project-dir", d, "--test-cmd", PASS);
    expect(r.code).toBe(1);
    expect(r.out).toContain("src/a.ts:2: tls-verification-off");
    expect(r.out).toContain("src/k.pem:1: secret");
    expect(r.out).not.toContain("tests/fixtures/x.ts");
    expect(r.out).not.toContain("src/ok.py");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("scan: a focused test outside a test path is not a hit, and a non-git dir reports and passes", () => {
  const d = gitProj({}, { "src/doc.ts": `// call ${ONLY}( to focus\n` });
  try { expect(run("--project-dir", d, "--test-cmd", PASS).code).toBe(0); }
  finally { rmSync(d, { recursive: true, force: true }); }
  const e = proj();
  try {
    writeFileSync(join(e, "a.test.ts"), `${ONLY}('x', () => {})\n`);
    const r = run("--project-dir", e, "--test-cmd", PASS);
    expect(r.code).toBe(0);
    expect(r.out).toContain("leg dev-gate exit=0");
    expect(r.out).toContain("nothing in scope (not a git repo)");
  } finally { rmSync(e, { recursive: true, force: true }); }
});

// NON-VACUITY: a test command that ran nothing cannot pass the gate, whatever it exits.
test("a test command with no runner summary is COULD-NOT-CHECK (2), not a pass", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", "true");
    expect(r.code).toBe(2);
    expect(r.out).toContain("leg tests exit=2");
    expect(r.err).toContain("COULD-NOT-CHECK: leg tests printed no count line");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a runner that reports zero tests is COULD-NOT-CHECK (2)", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", "echo '0 passed in 0.01s'");
    expect(r.code).toBe(2);
    expect(r.err).toContain("leg tests examined 0 — vacuous");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the tests leg counts what the runner ran, and --test-count-re counts an unknown runner", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", "printf ' 3 pass\\n 0 fail\\nRan 3 tests across 2 files.\\n'");
    expect(r.code).toBe(0);
    expect(r.err).toContain("tests: 3 test(s) examined (bun)");
    const c = run("--project-dir", d, "--test-cmd", "echo 'checked 7 cases'", "--test-count-re", "checked (\\d+) cases");
    expect(c.code).toBe(0);
    expect(c.err).toContain("tests: 7 test(s) examined (custom)");
    expect(c.err).toContain("lint: 0 command(s) examined — nothing in scope (declined)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The scope leg: a changed path under no task's writablePaths/scaffoldPaths in --plan fails the gate, named.
test("scope: --plan makes a stray edit exit 1 with the path; an in-scope edit passes; no --plan says not declared", () => {
  const d = gitProj({ "src/a.ts": "export {}\n" }, {});
  try {
    const plan = join(d, "plan.md");
    writeFileSync(plan, `<!-- work:dispatch ${JSON.stringify({ args: { projectDir: d, tasks: [{ id: "T1", writablePaths: ["src"], refs: [] }] } })} -->\n`);
    spawnSync("git", ["-C", d, "add", "-A"], { timeout: 30_000 }); spawnSync("git", ["-C", d, "commit", "-qm", "plan"], { timeout: 30_000 });
    writeFileSync(join(d, "src/a.ts"), "export const x = 1\n");
    const ok = run("--project-dir", d, "--test-cmd", PASS, "--plan", plan);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("leg scope exit=0");
    expect(run("--project-dir", d, "--test-cmd", PASS, "--no-plan").out).toContain("leg scope exit=0 (declined)");
    writeFileSync(join(d, "stray.txt"), "x\n");
    const bad = run("--project-dir", d, "--test-cmd", PASS, "--plan", plan);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("leg scope exit=1");
    expect(bad.out).toContain("stray.txt");
    expect(run("--project-dir", d, "--test-cmd", PASS, "--plan", join(d, "nope.md")).code).toBe(2);
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 600_000);

// An omitted --plan used to pass the scope leg as "not declared"; it now refuses unless --no-plan says so.
test("scope: no --plan is exit 2 naming the flag; --no-plan is exit 0 declined; --plan runs the leg", () => {
  const d = proj();
  try {
    const none = runRaw("--project-dir", d, "--test-cmd", PASS);
    expect(none.code).toBe(2);
    expect(none.err).toContain("--plan");
    expect(none.err).toContain("--no-plan");
    expect(none.out).not.toContain("leg scope exit=0");
    const declined = runRaw("--project-dir", d, "--test-cmd", PASS, "--no-plan", "--no-lint-cmd", "--no-build-cmd");
    expect(declined.code).toBe(0);
    expect(declined.out).toContain("leg scope exit=0 (declined)");
    const plan = join(d, "plan.md");
    writeFileSync(plan, `<!-- work:dispatch ${JSON.stringify({ args: { projectDir: d, tasks: [{ id: "T1", writablePaths: ["src"], refs: [] }] } })} -->\n`);
    const ran = runRaw("--project-dir", d, "--test-cmd", PASS, "--plan", plan, "--no-lint-cmd", "--no-build-cmd");
    expect(ran.out).toMatch(/leg scope exit=\d+(?! \(declined\))/);
    expect(ran.out).not.toContain("leg scope exit=0 (declined)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// work-checks.sh exports WORK_RUN_BASELINE to every mechanical check, for check.sh's OWN legs (scope,
// dev-gate). The project's commands must not inherit it: teaching's suite spawns its checkers in temp
// git repos, and those honour the variable, so "lines added over HEAD" read nothing and 15 tests failed
// only inside a work round (2026-10-15). Each project command here fails if it can see the variable.
test("the project's test, lint and build commands run without WORK_RUN_BASELINE", () => {
  const d = proj();
  try {
    const blind = (ok: string) => `if [ -n "\${WORK_RUN_BASELINE+x}" ]; then echo "saw baseline $WORK_RUN_BASELINE"; exit 7; fi; ${ok}`;
    const r = spawnSync("bash", [CHECK, "--project-dir", d, "--test-cmd", blind(PASS), "--lint-cmd", blind("true"),
      "--build-cmd", blind("true"), "--no-plan"], {
      timeout: 120_000, encoding: "utf8",
      env: { ...process.env, WORK_RUN_BASELINE: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(out).not.toContain("saw baseline");
    expect(r.stdout).toContain("leg tests exit=0");
    expect(r.stdout).toContain("leg lint exit=0");
    expect(r.stdout).toContain("leg build exit=0");
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 150_000);

// The other half: check.sh's OWN legs still read WORK_RUN_BASELINE. A focused test and a stray path
// that were already in the baseline tree are not this run's change, so dev-gate and scope pass with
// the baseline and fail without it.
test("dev-gate and scope still judge against WORK_RUN_BASELINE", () => {
  const d = gitProj({ "src/a.ts": "export {}\n" }, { "tests/b.test.ts": `${ONLY}('z', () => {})\n`, "stray.txt": "x\n" });
  try {
    const plan = join(d, "plan.md");
    writeFileSync(plan, `# p\n<!-- work:dispatch\n${JSON.stringify({ args: { projectDir: d, tasks: [{ id: "T1", writablePaths: ["src/"], refs: [] }] } })}\n-->\n`);
    const gitIn = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { timeout: 30_000, encoding: "utf8" }).stdout.trim();
    gitIn("add", "-A");
    const tree = gitIn("write-tree");
    gitIn("reset", "-q");
    expect(tree).toMatch(/^[0-9a-f]{40}$/);
    const go = (env: Record<string, string>) => {
      const r = spawnSync("bash", [CHECK, "--project-dir", d, "--test-cmd", PASS, "--no-lint-cmd", "--no-build-cmd", "--plan", plan], {
        timeout: 120_000, encoding: "utf8", env: { ...process.env, ...env },
      });
      return r.stdout ?? "";
    };
    const { WORK_RUN_BASELINE: _drop, ...plain } = process.env as Record<string, string>;
    const without = spawnSync("bash", [CHECK, "--project-dir", d, "--test-cmd", PASS, "--no-lint-cmd", "--no-build-cmd", "--plan", plan], {
      timeout: 120_000, encoding: "utf8", env: plain,
    }).stdout ?? "";
    expect(without).toContain("leg dev-gate exit=1");
    expect(without).toContain("leg scope exit=1");
    const withBase = go({ WORK_RUN_BASELINE: tree });
    expect(withBase).toContain("leg dev-gate exit=0");
    expect(withBase).toContain("leg scope exit=0");
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 500_000);
