// The wiring between the prose engine (scripts/prose-audit.py) and the writing workflow's constraints,
// as the prose hook (hooks/writing-prose-check.ts) splits them, pinned so the next move is loud.
//
// Both defects this file was written for were invisible at run time. A split that silences a
// structural constraint does not throw -- the constraint just stops reporting. A computed engine path
// that misses does not throw either -- the subprocess raised, a bare `except` swallowed it, and a
// SEVERITY="hard" constraint was filed under `passed`. The split is now DERIVED (the layout minus what
// the audit owns, hooks/lib/structural_constraints.py), so these tests run it rather than read a list.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { useTmp } from "./helpers/tmp.ts";

const REPO = dirname(import.meta.dir);
const HELPER = join(REPO, "hooks", "lib", "structural_constraints.py");
const mkTmp = useTmp();

function split(workflow: string, env: Record<string, string> = {}): { structural: string[]; owned: string[] } {
  const p = Bun.spawnSync(["python3", HELPER, workflow, "--list"], { env: { ...process.env, ...env }, timeout: 120_000 });
  expect(p.exitCode, p.stderr.toString()).toBe(0);
  const j = JSON.parse(p.stdout.toString());
  return { structural: j.structural.map((f: string) => basename(f, ".py")).sort(), owned: j.owned.map((f: string) => basename(f, ".py")).sort() };
}

const STRUCTURAL = ["writing-anchored-numbers", "writing-outline-sync", "writing-shortjournal", "writing-style", "writing-topic-sentences"];
/** A register level adds its register-crossing to writing's structural set; no pattern table of its own joins it. */
const REGISTER_STRUCTURAL = [...STRUCTURAL, "register-crossing"].sort();

describe("the structural set is the layout's writing constraints minus what prose-audit owns", () => {
  test("writing: the structural constraints run; every table module and the delegating bold-lead do not", () => {
    const { structural, owned } = split("writing");
    expect(structural).toEqual(STRUCTURAL);
    for (const o of ["scored-tics-patterns", "strunk-elements-of-style", "wikipedia-structural-patterns", "wikipedia-chatgpt-artifacts", "writing-no-bold-lead"])
      expect(owned).toContain(o);
  });

  test("a register's style guide is the audit's too: writing/legal adds Volokh to the owned side, writing/econ McCloskey", () => {
    const legal = split("writing/legal");
    expect(legal.structural).toEqual(REGISTER_STRUCTURAL);
    expect(legal.owned).toContain("volokh-distilled");
    const econ = split("writing/econ");
    expect(econ.structural).toEqual(REGISTER_STRUCTURAL);
    expect(econ.owned).toContain("mccloskey-economical-writing");
    expect(split("writing/general").structural).toEqual(REGISTER_STRUCTURAL);
  });

  test("a structural constraint dropped into the layout is run with no edit anywhere; a table dropped there is the audit's", () => {
    const plug = mkTmp("wiring-plug-");
    cpSync(join(REPO, "checks", "writing"), join(plug, "checks", "writing"), { recursive: true });
    writeFileSync(join(plug, "checks", "writing", "constraints", "writing-new-structure.py"), "import sys\nprint('writing-new-structure: 0 file(s) examined — nothing in scope (none)')\n");
    writeFileSync(join(plug, "checks", "writing", "constraints", "new-tics.py"), '_NEW = [\n    (r"\\bsynergy\\b", "new-tic·synergy"),\n]\n');
    const { structural, owned } = split("writing", { WORKFLOW_CHECKS_PATH: plug });
    expect(structural).toContain("writing-new-structure");
    expect(owned).toContain("new-tics");
    expect(structural).not.toContain("new-tics");
  });
});

describe("writing-no-bold-lead resolves the engine it delegates to", () => {
  // It carries no regex of its own: if PROSE_AUDIT does not resolve, the constraint cannot fire at
  // all. Asserted by importing the module and reading the path it actually computed, so a wrong
  // parents[N] fails here rather than passing quietly through the runner.
  const MODULE = join(REPO, "checks", "writing", "constraints", "writing-no-bold-lead.py");

  test("PROSE_AUDIT points at a file that exists", () => {
    const proc = Bun.spawnSync([
      "python3", "-c",
      "import importlib.util,sys;" +
      `spec=importlib.util.spec_from_file_location("nbl", ${JSON.stringify(MODULE)});` +
      "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(m.PROSE_AUDIT)",
    ], { timeout: 120_000 });
    const resolved = proc.stdout.toString().trim();
    expect(proc.exitCode, proc.stderr.toString()).toBe(0);
    expect(resolved).toBe(join(REPO, "scripts", "prose-audit.py"));
    expect(existsSync(resolved)).toBe(true);
  });

  test("an unreachable engine raises rather than returning a clean pass", () => {
    // SEVERITY is "hard", so `except Exception: return []` reported "no bold leads found" for a
    // checker that never ran. The constraint contract turns a raised exception into exit 2.
    const d = mkTmp("nbl-");
    mkdirSync(join(d, "drafts"));
    const draft = join(d, "drafts", "a.md");
    writeFileSync(draft, "**Bold lead.** Body text follows here.\n");
    const proc = Bun.spawnSync([
      "python3", "-c",
      "import importlib.util,pathlib,sys;" +
      `spec=importlib.util.spec_from_file_location("nbl", ${JSON.stringify(MODULE)});` +
      "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);" +
      "m.PROSE_AUDIT=pathlib.Path('/nonexistent/prose-audit.py');" +
      `\ntry:\n m.check({'cwd': ${JSON.stringify(d)}, 'files': [pathlib.Path(${JSON.stringify(draft)})]})\nexcept Exception as e:\n print('RAISED'); sys.exit(0)\nprint('SILENT'); sys.exit(1)`,
    ], { timeout: 120_000 });
    expect(proc.stdout.toString().trim(), proc.stderr.toString()).toBe("RAISED");
  });
});
