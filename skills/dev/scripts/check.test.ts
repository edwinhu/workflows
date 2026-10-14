import { test, expect, setDefaultTimeout } from "bun:test";

setDefaultTimeout(300_000);
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CHECK = join(import.meta.dir, "check.sh");
const run = (...a: string[]) => {
  const r = spawnSync("bash", [CHECK, ...a], { timeout: 120_000, encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
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
    expect(r.out).toContain("not declared");
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

test("an undeclared leg passes and says so, so it cannot be mistaken for absent", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", PASS);
    expect(r.code).toBe(0);
    expect(r.out).toContain("leg build exit=0 (not declared)");
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
    expect(c.err).toContain("lint: 0 command(s) examined — nothing in scope (not declared)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
