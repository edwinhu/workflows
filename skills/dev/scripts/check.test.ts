import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
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
