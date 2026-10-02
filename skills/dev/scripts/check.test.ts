import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CHECK = join(import.meta.dir, "check.sh");
const run = (...a: string[]) => {
  const r = spawnSync("bash", [CHECK, ...a], { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const proj = () => mkdtempSync(join(tmpdir(), "devcheck-"));

test("every leg reports, and none short-circuits the ones after it", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", "false", "--lint-cmd", "true", "--build-cmd", "true");
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
    const r = run("--project-dir", d, "--test-cmd", "true", "--lint-cmd", "true", "--build-cmd", "true");
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
    expect(r.err).toContain("ran nothing");
    expect(r.out).toContain("not declared");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("an undeclared leg passes and says so, so it cannot be mistaken for absent", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", "true");
    expect(r.code).toBe(0);
    expect(r.out).toContain("leg build exit=0 (not declared)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a bad project dir and an unknown flag are both refusals", () => {
  expect(run("--project-dir", "/nope/nope", "--test-cmd", "true").code).toBe(2);
  expect(run("--project-dir", ".", "--wat").code).toBe(2);
});

// The command runs IN the project, not wherever the gate was invoked from.
test("a leg runs inside --project-dir", () => {
  const d = proj();
  try {
    const r = run("--project-dir", d, "--test-cmd", `test "$(pwd -P)" = "$(cd ${d} && pwd -P)"`);
    expect(r.code).toBe(0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The scan leg reads only the lines a change adds. Patterns are assembled at runtime so this file
// does not itself trip the scan when the dev gate runs over this repo.
const ONLY = ["it", "only"].join(".");
const KEY = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
function gitProj(files: Record<string, string>, after: Record<string, string>) {
  const d = proj();
  const git = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  git("add", "-A"); git("commit", "-qm", "base", "--allow-empty");
  for (const [f, c] of Object.entries(after)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); }
  return d;
}

test("scan: an added focused test fails the gate; the same line committed before does not", () => {
  const d = gitProj({ "tests/a.test.ts": `${ONLY}('x', () => {})\n` }, { "tests/a.test.ts": `${ONLY}('x', () => {})\nit('y', () => {})\n` });
  try {
    const clean = run("--project-dir", d, "--test-cmd", "true");
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("leg scan exit=0");
    writeFileSync(join(d, "tests/b.test.ts"), `${ONLY}('z', () => {})\n`);
    const r = run("--project-dir", d, "--test-cmd", "true");
    expect(r.code).toBe(1);
    expect(r.out).toContain("leg scan exit=1");
    expect(r.err).toContain("focused-or-skipped-test: tests/b.test.ts:1");
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
    const r = run("--project-dir", d, "--test-cmd", "true");
    expect(r.code).toBe(1);
    expect(r.err).toContain("tls-verification-off: src/a.ts:2");
    expect(r.err).toContain("secret: src/k.pem:1");
    expect(r.err).not.toContain("fixtures/");
    expect(r.err).not.toContain("src/ok.py");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("scan: a focused test outside a test path is not a hit, and a non-git dir reports and passes", () => {
  const d = gitProj({}, { "src/doc.ts": `// call ${ONLY}( to focus\n` });
  try { expect(run("--project-dir", d, "--test-cmd", "true").code).toBe(0); }
  finally { rmSync(d, { recursive: true, force: true }); }
  const e = proj();
  try {
    const r = run("--project-dir", e, "--test-cmd", "true");
    expect(r.code).toBe(0);
    expect(r.out).toContain("leg scan exit=0 (not a git repo)");
  } finally { rmSync(e, { recursive: true, force: true }); }
});
