import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = dirname(import.meta.dir);

// THE ZERO-ARGUMENTS CONTRACT. A checker handed no input examined nothing. Exit 0 then reads as
// "PASS" over nothing and exit 1 reads as "violations found" -- both are lies, and both are what
// every caller in this codebase believes. Could-not-run is exit 2 plus a message naming what was
// missing.
//
// The shape here is typst's tests/zero-args-contract.test.ts (typst 0958b3d), where the identical
// sweep found fifteen checkers whose entry line was
//     cwd = sys.argv[1] if len(sys.argv) > 1 else "."
// so a forgotten argument did not fail: it scanned the caller's directory and printed PASS.

// -- Population ---------------------------------------------------------------
// Every shipped program under the directories whose files are CHECKERS -- programs whose exit
// code is read as a verdict. The sweep is a directory listing, not a hand-kept list: a checker
// added tomorrow is swept the day it lands, and the only way out is an entry in EXCLUSIONS with
// a reason.
//
// Why these six and not `skills/*/scripts/`: the per-skill scripts directories are domain
// tooling -- WRDS ETL, docx builders, PDF extraction, batch submitters -- whose exit codes are
// "the tool ran", not "the corpus is clean". The constraint directories plus scripts/checks are
// where a bare exit 0 is read by a gate as PASS. The per-skill constraint directories are
// DISCOVERED rather than listed: `skills/ds/constraints/` was on the list only so that a .py
// dropped there would be swept on arrival, and it held nothing but .md, so the rules/constraints
// split deleted the directory and with it a named entry that then failed as a missing dir.
// Discovery keeps the arrival guarantee for every skill at once, including ones not yet written.
const CHECKER_DIRS = [
  "constraints",
  "scripts",
  "scripts/checks",
  ...readdirSync(join(ROOT, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "skills", e.name, "constraints")))
    .map((e) => `skills/${e.name}/constraints`)
    .sort(),
];

// -- Exclusions ---------------------------------------------------------------
// A silent exclusion is how a checker escapes a sweep. Each one names its reason, and each
// reason is one of exactly four kinds:
//   NO ENTRY POINT   -- an importable module; there is nothing to invoke.
//   ZERO ARGS IS THE INVOCATION -- it discovers its own input, so no arguments is a complete run.
//   SIDE EFFECT, NOT EXECUTED -- running it bare would write outside a temp dir, so this sweep
//                       must NOT execute it. That is a finding about the file, not a pass.
//   NOT A CHECKER    -- a tool, generator or loader whose exit code is not a verdict over a
//                       corpus, so "PASS over nothing" is not a failure mode it has.
const EXCLUSIONS: Record<string, string> = {
  "constraints/_ds_logging.py":
    "NO ENTRY POINT: shared structured-logging helper for the ds-* checkers. No __main__.",
  "constraints/_ds_waivers.py":
    "NO ENTRY POINT: the per-line waiver parser imported by every ds-* checker. Its only " +
    "occurrence of __main__ is the word inside its docstring; there is no guard.",
  "scripts/prose_extract.py":
    "NO ENTRY POINT: draft discovery + md/docx paragraph extraction for the writing checks. No __main__.",
  "scripts/checks/hook_output_schema.py":
    "NO ENTRY POINT: the per-event hook output schema plus a validate() function. No __main__; " +
    "scripts/check-hooks.sh drives it.",
  "scripts/check-hooks.sh":
    "ZERO ARGS IS THE INVOCATION: it cd's to the repo root and validates this repo's own wired " +
    "hooks against the per-event schema. It takes no input paths, so there is no missing input to report.",
  "scripts/bluebook-coverage.ts":
    "ZERO ARGS IS THE INVOCATION: computes bluebook coverage from this repo's own corpus, " +
    "references and verification reports, which it locates from import.meta.dir.",
  "scripts/hook-golden.ts":
    "ZERO ARGS IS THE INVOCATION: the golden harness replays this repo's own hooks from " +
    "tests/golden/. It finds its own inputs and spawns every hook, so the sweep does not run it.",
  "scripts/scan-public-privacy.ts":
    "ZERO ARGS IS THE INVOCATION: with no argv[2] it resolves the plugin root from " +
    "import.meta.dir and scans this repo -- it defaults to a real corpus, not to the caller's cwd.",
  "scripts/bump-version.sh":
    "SIDE EFFECT, NOT EXECUTED: rewrites the six version sites across four files. Not a checker.",
  "scripts/setup_garamond_render_override.py":
    "SIDE EFFECT, NOT EXECUTED: builds and installs an x2t font render override outside this repo.",
  "scripts/retarget-hooks.ts":
    "SIDE EFFECT, NOT EXECUTED: rewrites hook wirings in hooks.json and skills/*/SKILL.md under --apply.",
  "scripts/doc_render.py":
    "NOT A CHECKER: the docx/pptx/xlsx -> PDF/PNG converter. Its exit code means the render ran, " +
    "and running it bare would write rendered output.",
  "scripts/docx_repair.py":
    "NOT A CHECKER: repairs a Google-Docs-exported .docx in place. Exit code means the repair ran.",
  "scripts/x2t_kern.py":
    "NOT A CHECKER: injects pair kerning into an x2t PDF IN PLACE. A mutation tool, not a verdict.",
  "scripts/writing-source-first-guard.py":
    "NOT A CHECKER: a PreToolUse hook. It reads one JSON event on stdin and emits a hook decision; " +
    "zero arguments is the only way the harness ever invokes it.",
  "scripts/load-constraints":
    "NOT A CHECKER: the extensionless caller-facing name for the constraint loader. It prints " +
    "constraint prose; its exit code carries no verdict over a corpus.",
  "scripts/load-constraints.ts":
    "NOT A CHECKER: the constraint loader itself (published `constraint-loader` capability). " +
    "It emits .md prose for a skill scope; exit 0 does not mean any corpus was clean.",
  "skills/ai-anti-patterns/constraints/scored-tics-patterns.py":
    "NO ENTRY POINT: a GENERATED regex/label table imported by the tic scorers. No __main__, no shebang.",
};

const REASON_KINDS =
  /^(NO ENTRY POINT|ZERO ARGS IS THE INVOCATION|SIDE EFFECT, NOT EXECUTED|NOT A CHECKER):/;

// A shipped program is anything with a runnable extension, plus any executable carrying a
// shebang -- `scripts/load-constraints` is deliberately extensionless, and an extension filter
// alone would let a file like it slip past both lists.
function isProgram(abs: string, name: string): boolean {
  if (name.endsWith(".py") || name.endsWith(".sh") || name.endsWith(".ts")) return true;
  const st = statSync(abs);
  if (!st.isFile() || (st.mode & 0o111) === 0) return false;
  return readFileSync(abs, "utf8").slice(0, 2) === "#!";
}

function shippedPrograms(dir: string): string[] {
  const abs = join(ROOT, dir);
  expect(existsSync(abs), `${dir} does not exist -- the sweep would silently shrink`).toBe(true);
  return readdirSync(abs)
    .filter((name) => {
      const p = join(abs, name);
      return statSync(p).isFile() && isProgram(p, name);
    })
    .map((name) => `${dir}/${name}`);
}

function population(): string[] {
  const files: string[] = [];
  for (const dir of CHECKER_DIRS) {
    for (const rel of shippedPrograms(dir)) {
      if (rel in EXCLUSIONS) continue;
      files.push(rel);
    }
  }
  return files.sort();
}

const FILES = population();

// A sweep that swept nothing would be green. Pin the floor.
test("the sweep has a population", () => {
  expect(FILES.length).toBeGreaterThan(25);
});

// Every exclusion must name a file that exists; a stale key is an exclusion nobody notices.
test("every exclusion names a shipped file and carries a reason", () => {
  for (const [rel, reason] of Object.entries(EXCLUSIONS)) {
    expect(existsSync(join(ROOT, rel)), `excluded ${rel} does not exist`).toBe(true);
    expect(reason, `${rel}: exclusion has no reason`).toMatch(REASON_KINDS);
  }
});

// The NO ENTRY POINT reason is checkable, so check it rather than trusting the sentence.
test("every NO ENTRY POINT exclusion really has no __main__ guard", () => {
  const bad: string[] = [];
  for (const [rel, reason] of Object.entries(EXCLUSIONS)) {
    if (!reason.startsWith("NO ENTRY POINT")) continue;
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (/^\s*if\s+__name__\s*==/m.test(src)) bad.push(`${rel} is excluded as a module but has a __main__ guard`);
  }
  expect(bad.join("\n")).toBe("");
});

// -- The contract -------------------------------------------------------------
// Run each file from an EMPTY directory. A checker that defaults to scanning "." then has
// nothing to find, which is exactly the "PASS over nothing" this contract exists to forbid --
// and it keeps the sweep from reading this repo's own sources.
function runBare(rel: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "zeroargs-"));
  try {
    const abs = join(ROOT, rel);
    const cmd = rel.endsWith(".py")
      ? ["python3", abs]
      : rel.endsWith(".ts")
        ? ["bun", abs]
        : ["bash", abs];
    const r = spawnSync(cmd[0], cmd.slice(1), {
      encoding: "utf8", cwd: dir, timeout: 120_000, input: "",
    });
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// "Says what was missing" has to be decidable, so it is the vocabulary a caller can grep for:
// the COULD-NOT phrasing this codebase standardised on, a usage/error line, or an explicit
// "no <thing> named" / "takes <args>" naming the input that was absent. The exit code is the
// contract; this is the second half of it -- a bare 2 with no explanation is a dead end.
// A usage SYNOPSIS -- `python3 ds-chart-color.py <file.py|dir>` -- names the missing input as
// plainly as the word "usage:" does, so it counts. The exit code is untouched by this.
const EXPLAINED =
  /COULD-NOT-RUN|COULD-NOT-CHECK|NO CHECK RAN|usage:|Usage:|Error:|is required|supply |no [\w-]+ ?[\w-]* named|takes <|(python3|bash|bun) \S+ </;

for (const rel of FILES) {
  test(`${rel}: zero arguments exits 2 and names what was missing`, () => {
    const { status, out } = runBare(rel);
    expect(status, `${rel} exited ${status} with no input -- 0 reads as PASS over nothing, ` +
      `1 reads as violations found. Output:\n${out}`).toBe(2);
    expect(out.trim().length, `${rel} exited 2 but said nothing about what was missing`).toBeGreaterThan(0);
    expect(out, `${rel} exited 2 without naming the missing input:\n${out}`).toMatch(EXPLAINED);
  });
}

// Every shipped program under the checker directories is either swept or excluded -- nothing
// falls between. This is the test that breaks if someone drops a file in and forgets both lists.
test("no shipped checker-directory file is neither swept nor excluded", () => {
  const accounted = new Set([...FILES, ...Object.keys(EXCLUSIONS)]);
  const missing: string[] = [];
  for (const dir of CHECKER_DIRS) {
    for (const rel of shippedPrograms(dir)) if (!accounted.has(rel)) missing.push(rel);
  }
  expect(missing.join("\n")).toBe("");
});

// Guard against the shebang-less script: python3/bash/bun are invoked explicitly above, so a
// file that is not actually a program would still "run". Keep the population honest.
test("every swept file is a program", () => {
  const bad: string[] = [];
  for (const rel of FILES) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (!src.startsWith("#!") && !/^\s*if\s+__name__\s*==/m.test(src)) {
      bad.push(`${rel}: no shebang and no __main__ guard`);
    }
  }
  expect(bad.join("\n")).toBe("");
});
