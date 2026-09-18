import { test, expect, afterAll } from "bun:test";
import {
  existsSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const ROOT = dirname(import.meta.dir);
const CHECK = join(ROOT, "skills/workflow-creator/scripts/check.sh");
const AUDIT = "/home/eh/projects/plugin-utils/bin/workflow-audit";

// THE GATE-VACUITY CONTRACT. `workflow-audit` reports "workflows failing their own gate: 0 of 10".
// That is ten observations of PASSING and no evidence any of the ten CAN fail. A gate that returns
// a constant 0 produces exactly the same line, and this repo has shipped that failure repeatedly:
// 15 typst checkers and 28 workflows checkers that printed PASS over whatever directory the caller
// stood in; a pollev hook reading a `TOOL_INPUT` env var that appears 0 times in the harness binary
// and exited 0 on every real event; `ds-join-audits` accepting `print("done, have a nice day")` as
// proof a merge logged its row counts. Passing is not evidence of measuring.
//
// METHOD -- the preferred one in full, for all ten. For each workflow W:
//
//   1. Build a THROWAWAY PLUGIN ROOT in $TMPDIR that resolves `${CLAUDE_PLUGIN_ROOT}` exactly as
//      W's real plugin root does: every top-level entry and every SIBLING skill is symlinked (the
//      probe walks only --target, so a sibling need only exist for path resolution), and W itself
//      is COPIED so it can be perturbed. Verified below: for eight of the ten the scaffolded copy
//      reproduces the real tree's verdict exactly — compared against a gate run on the REAL target,
//      not against a hardcoded 0. The scaffold is a stand-in, so what it must reproduce is whatever
//      the real tree says. Hardcoding 0 asserted something stronger AND weaker at once: it went red
//      when a workflow's plugin legitimately went red (teaching's three, the day check.sh grew its
//      pc-probe leg), and it would have stayed green if a scaffold passed while the real tree failed
//      — which is the direction that actually makes the injections meaningless.
//   2. Assert the unperturbed copy's wc-probe leg exits 0 and names neither injected rule. This is
//      the control: without it, a gate that fails on everything would "pass" this test.
//   3. Inject ONE violation of ONE rule the gate claims to enforce, and assert the gate now returns
//      a FAILING verdict that NAMES that rule.
//
// Two independent injections per workflow, so the result does not rest on one rule's code path:
//
//   P3 frontmatter    -- an undocumented key in SKILL.md's frontmatter (`DOCUMENTED_FRONTMATTER_KEYS`
//                        in wc-probe.ts). A key the harness silently ignores.
//   P2 path-resolution -- a `${CLAUDE_PLUGIN_ROOT}/...` reference in SKILL.md to a file that does
//                        not exist. A reference the agent cannot Read.
//
// No workflow got the weaker leg-count/exit-2 treatment. All ten are proven behaviourally.
//
// NEGATIVE CONTROL, run once by hand rather than shipped (it would double the runtime): this file
// with `check.sh` replaced by a stub that prints six `exit=0` legs and returns 0 fails with
// "dev: injecting a P3 frontmatter violation did not fail the wc-probe leg". A vacuous gate cannot
// satisfy this test.
//
// ONE CAVEAT, stated rather than papered over: `work` and `workflow-creator` ship suites that are
// PATH-SENSITIVE -- their own scripts/*.test.ts assert against repo-absolute layout, so in a
// scaffolded copy the `probe-tests` leg fails for reasons unrelated to the injection, and check.sh's
// overall exit is already non-zero at baseline. For those two the failing-verdict assertion is made
// on the WC-PROBE LEG (exit 0 -> exit 1, rule named), which is the leg that judges the workflow;
// `parity` takes no target at all, and `node-check`/`probe-tests` are structural. Every other
// workflow is asserted on BOTH the wc-probe leg and check.sh's overall exit code.

// -- Population ---------------------------------------------------------------
// The ten targets, read from `workflow-audit` itself rather than hand-copied, so a workflow added
// to the audit tomorrow is asserted the day it lands. A hand-kept list that drifts from the audit
// is the same vacuity one level up: this file would keep reporting 10-of-10 over nine.
// Read the COMMITTED workflow-audit, not the working copy. The population is a committed fact,
// and reading the file on disk couples this verdict to whether someone in another repo happens to
// have it open: measured 2026-09-17, a row editing five plugin-utils binaries turned every test
// here red for the minutes it held them. A dirty neighbour is not a failing gate.
function auditSource(): string {
  const r = spawnSync("git", ["-C", dirname(dirname(AUDIT)), "show", `HEAD:bin/${basename(AUDIT)}`],
                      { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout;
  // Fail CLOSED and say which: an unreadable population is could-not-run, never an empty one.
  throw new Error(
    `cannot read the committed ${AUDIT} (git exit ${r.status}); refusing to derive a population from an unknown state`);
}

function auditTargets(): string[] {
  const src = auditSource();
  const m = /^LIST=(?:"([\s\S]*?)")$/m.exec(src);
  if (!m) throw new Error(`${AUDIT}: could not find the LIST= assignment this test reads its population from`);
  const wf = /^WF=(\S+)$/m.exec(src);
  if (!wf) throw new Error(`${AUDIT}: could not find the WF= assignment`);
  return m[1]
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/\$WF|\$\{WF\}/g, wf[1]));
}

const TARGETS = auditTargets();

test("the population is the audit's own ten targets", () => {
  expect(TARGETS.length).toBe(10);
  expect(TARGETS.map((t) => basename(t)).sort()).toEqual(
    [
      "dev",
      "ds",
      "exams",
      "notes",
      "skill-creator",
      "slides",
      "workflow-creator",
      "workshop",
      "work",
      "writing",
    ].sort(),
  );
});

// `work` and `workflow-creator` ship path-sensitive suites; see the CAVEAT above. Named here so the
// exemption is declared in one place and a reader can count it.
const LEG_ONLY = new Set(["work", "workflow-creator"]);

// -- Scaffold -----------------------------------------------------------------

/** Submodule paths, read from .gitmodules: another repo delivered into this tree. */
function submodulePaths(pluginRoot: string): Set<string> {
  const f = join(pluginRoot, ".gitmodules");
  if (!existsSync(f)) return new Set();
  return new Set(
    readFileSync(f, "utf8").split("\n")
      .map((l) => l.trim().match(/^path\s*=\s*(\S+)$/)?.[1])
      .filter((x): x is string => Boolean(x)),
  );
}

/** Is this plugin-root entry a real directory of the plugin's own code, which must be COPIED?
 *  A probe or runner anchors on its own `__file__` and skips symlinks, so through a link it
 *  anchors in the REAL tree and the scaffold stops standing in. Measured twice: a symlinked
 *  `constraints/` made teaching/exams' runner refuse the scaffolded dir (exit 2 against a real
 *  tree exiting 0), and a symlinked `scripts/` hid workflows' load-constraints from sc-probe's
 *  keysSomethingReads, collapsing its allowed-key set and flagging four correct ds/writing files.
 *  Dot-directories (caches, worktrees, .pixi -- 2.3 GB in workflows), `scratch` and submodules
 *  are symlinked: no probe reads them, and copying them is what makes this unaffordable. */
function mustCopy(pluginRoot: string, name: string, submodules: Set<string>): boolean {
  if (name.startsWith(".") || name === "scratch" || submodules.has(name)) return false;
  try {
    return statSync(join(pluginRoot, name)).isDirectory();
  } catch {
    return false;
  }
}

/** Build the throwaway plugin root and return the path of the copied skill under test. */
function scaffold(skillDir: string, root: string): string {
  const pluginRoot = resolve(skillDir, "..", "..");
  const submodules = submodulePaths(pluginRoot);
  const name = basename(skillDir);
  mkdirSync(join(root, "skills"), { recursive: true });
  for (const e of readdirSync(pluginRoot).concat([".claude-plugin"])) {
    if (e === "skills") continue;
    const src = join(pluginRoot, e);
    if (!existsSync(src)) continue;
    if (existsSync(join(root, e))) continue;
    // A directory holding a discovery runner is COPIED, never symlinked. Such a runner anchors the
    // set it will dispatch at its own `__file__` and refuses a directory outside that set, so
    // through a symlink it anchors in the REAL tree, does not discover the scaffolded skill's
    // constraints dir, and correctly exits 2 -- a refusal the scaffold provoked rather than the
    // verdict the real tree returns. Measured 2026-09-18 on teaching/exams: symlinked, the gate's
    // probe-tests leg exited 1 against a real tree exiting 0; copied, both exit 0.
    // Derived from the property, not a name: any top-level dir holding a `run-*.py`.
    if (mustCopy(pluginRoot, e, submodules)) cpSync(src, join(root, e), { recursive: true, dereference: true });
    else symlinkSync(src, join(root, e));
  }
  for (const e of readdirSync(join(pluginRoot, "skills"))) {
    if (e === name) continue;
    symlinkSync(join(pluginRoot, "skills", e), join(root, "skills", e));
  }
  // dereference: the real tree delivers files by symlink in places, and a copy of a link is not a
  // file the perturbation can edit.
  cpSync(skillDir, join(root, "skills", name), { recursive: true, dereference: true });
  return join(root, "skills", name);
}

interface GateRun {
  code: number;
  out: string;
  /** Rule names of the FINDINGS reported, from wc-probe's `[severity] <rule>` header lines. */
  findingRules: string[];
  /** Exit code printed for one leg, or null when the leg printed no line at all. */
  leg(name: string): number | null;
}

// Async, and every gate run a workflow needs is launched at once: check.sh runs the TARGET's own
// scripts/ suite as its probe-tests leg, so a serial sweep pays for `work`'s 23 test files three
// times over and the whole file took ~9 minutes. The three runs touch three disjoint scaffolds.
async function runGate(target: string): Promise<GateRun> {
  const r = await new Promise<{ status: number; stdout: string; stderr: string }>((res, rej) => {
    const p = spawn("bash", [CHECK, "--target", target], { timeout: 600_000 });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d: string | Uint8Array) => (stdout += d));
    p.stderr.on("data", (d: string | Uint8Array) => (stderr += d));
    p.on("error", rej);
    p.on("close", (status: number | null) => res({ status: status ?? -1, stdout, stderr }));
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  // Findings ONLY, not any line mentioning a rule name. The `parity` leg prints its own fixture
  // verdicts (`unregistered.md: gate=P3 frontmatter`) on every single run, so a substring search
  // over the whole transcript reports every rule as present at baseline -- which is a control that
  // can never hold, i.e. this test failing vacuously in the opposite direction.
  const findingRules = [...out.matchAll(/^\[(?:critical|major|minor)\] (.+)$/gm)].map((m) => m[1].trim());
  return {
    code: r.status ?? -1,
    out,
    findingRules,
    leg(name: string) {
      const m = new RegExp(`^leg ${name} exit=(\\d+)`, "m").exec(r.stdout ?? "");
      return m ? Number(m[1]) : null;
    },
  };
}

/** Add an undocumented key to SKILL.md's frontmatter. Violates P3 and nothing else. */
function injectP3(fixture: string): void {
  const p = join(fixture, "SKILL.md");
  const t = readFileSync(p, "utf8");
  const close = t.indexOf("\n---", 3);
  if (close === -1) throw new Error(`${p}: no closing frontmatter fence to inject into`);
  writeFileSync(p, `${t.slice(0, close)}\nwc-vacuity-probe-key: injected${t.slice(close)}`);
}

/** Append a plugin-root reference to a file that does not exist. Violates P2 and nothing else. */
function injectP2(fixture: string): void {
  const p = join(fixture, "SKILL.md");
  writeFileSync(
    p,
    `${readFileSync(p, "utf8")}\nSee \${CLAUDE_PLUGIN_ROOT}/skills/${basename(fixture)}/references/wc-vacuity-absent.md for details.\n`,
  );
}

const INJECTIONS = [
  { rule: "P3 frontmatter", inject: injectP3 },
  { rule: "P2 path-resolution", inject: injectP2 },
] as const;

// -- The assertion ------------------------------------------------------------

// -- All ten targets run CONCURRENTLY -------------------------------------------------------
// bun executes the tests in a file one after another, so a test-per-target ran ten sequential
// batches of four gate runs: 262s of the suite's 315s. The work is independent -- separate
// scaffolds, separate temp dirs -- so it is started once, here, and each test awaits its own
// slice. One test per target is kept so a failure still names the workflow.
//
// POOLED, not all forty at once: each gate run spawns six legs and several of those spawn their
// own `bun test`, so an unbounded fan-out thrashes the machine and the timings stop meaning
// anything. Four targets in flight is sixteen concurrent gate runs.
const POOL = 4;

interface TargetRuns { base: GateRun; real: GateRun | null; injected: GateRun[]; tmp: string }

async function runTarget(target: string): Promise<TargetRuns> {
  const name = basename(target);
  const tmp = mkdtempSync(join(tmpdir(), `gate-vacuity-${name}-`));
  const [base, real, ...injected] = await Promise.all([
    runGate(scaffold(target, join(tmp, "base"))),
    // The real tree, unperturbed. Launched alongside the rest, so fidelity costs wall clock only
    // where the scaffold and the real tree could actually disagree.
    LEG_ONLY.has(name) ? Promise.resolve(null) : runGate(target),
    ...INJECTIONS.map(({ inject }, i) => {
      const fixture = scaffold(target, join(tmp, `inj${i}`));
      inject(fixture);
      return runGate(fixture);
    }),
  ]);
  return { base, real, injected, tmp };
}

async function runAll(): Promise<Map<string, TargetRuns>> {
  const out = new Map<string, TargetRuns>();
  const queue = [...TARGETS];
  const worker = async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      out.set(basename(t), await runTarget(t));
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, TARGETS.length) }, worker));
  return out;
}

// Started at module load, so the first test awaits work already in flight.
const ALL = runAll();

afterAll(async () => {
  for (const { tmp } of (await ALL).values()) rmSync(tmp, { recursive: true, force: true });
});

for (const target of TARGETS) {
  const name = basename(target);

  test(
    `${name}: its gate can return a FAILING verdict`,
    async () => {
      // A missing target is a HARD failure, never a skip. A workflow silently dropped from this
      // sweep is the vacuity the sweep exists to detect, arriving by the other door.
      expect(existsSync(target), `${target} does not exist, so its gate was never exercised`).toBe(true);

      const runs = (await ALL).get(name);
      expect(runs, `${name}: no gate run was recorded, so nothing was exercised`).toBeDefined();
      const { base, real, injected } = runs!;

      // -- control: the unperturbed copy passes the leg and reports neither rule --
      expect(base.leg("wc-probe"), `${name}: the wc-probe leg printed no line at all`).toBe(0);
      for (const { rule } of INJECTIONS) {
        expect(base.findingRules, `${name}: the unperturbed copy already reports ${rule}`).not.toContain(rule);
      }
      if (real) {
        expect(
          base.code,
          `${name}: the scaffolded copy's verdict (${base.code}) differs from the real tree's (${real.code}), so the injections below are made against a stand-in that does not stand in`,
        ).toBe(real.code);
      }

      // -- each injection flips the verdict and names its rule --
      for (const [i, { rule }] of INJECTIONS.entries()) {
        const run = injected[i];
        expect(run.leg("wc-probe"), `${name}: injecting a ${rule} violation did not fail the wc-probe leg`).toBe(1);
        expect(run.findingRules, `${name}: the failing verdict does not name ${rule}`).toContain(rule);
        expect(run.code, `${name}: check.sh returned a passing verdict over a ${rule} violation`).not.toBe(0);
      }
    },
    900_000,
  );
}
