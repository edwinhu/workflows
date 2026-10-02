import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// The five dev rules against their fixture twins. Each twin is a before/ tree (committed) and an
// after/ tree (left in the working tree), so the extractors see a real `git diff HEAD`. Files carry a
// .fixture suffix so bun never collects a fixture test as a suite of its own.
const BASE = join(import.meta.dir, "../../..");
const RULES_DIR = join(BASE, "constraints/jev/dev");
const FIX = join(BASE, "tests/fixtures/jev/dev");
const RULES = ["MOCK", "WEAK", "NET", "SHELL", "LOOP"] as const;
const made: string[] = [];
afterAll(() => made.forEach(d => rmSync(d, { recursive: true, force: true })));

function stripSuffix(dir: string) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) stripSuffix(p);
    else if (name.endsWith(".fixture")) renameSync(p, p.slice(0, -".fixture".length));
  }
}

function repo(rule: string, twin: "vio" | "sat"): string {
  const d = mkdtempSync(join(tmpdir(), `jev-dev-${rule}-${twin}-`));
  made.push(d);
  const git = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const before = join(FIX, rule, twin, "before");
  if (existsSync(before)) cpSync(before, d, { recursive: true });
  stripSuffix(d);
  git("add", "-A");
  git("commit", "-qm", "before", "--allow-empty");
  cpSync(join(FIX, rule, twin, "after"), d, { recursive: true });
  stripSuffix(d);
  return d;
}

function changed(d: string): string[] {
  const run = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { encoding: "utf8" }).stdout.trim();
  return [run("diff", "--name-only", "HEAD"), run("ls-files", "--others", "--exclude-standard")]
    .join("\n").split("\n").filter(Boolean).map(f => join(d, f));
}

function evidence(d: string): Record<string, any> {
  const r = spawnSync("python3", [join(RULES_DIR, "evidence.py"), "--files", ...changed(d), "--root", d], { encoding: "utf8" });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

// What the stub Jev treats as a violation, one deterministic reading of each rule's state. It stands
// in for the model so the test pins the wiring (state reaches Jev, p drives the exit), not the model.
const SIGNAL: Record<string, (s: any) => boolean> = {
  MOCK: s => s.n_changed_tests_asserting_only_on_mocks > 0,
  WEAK: s => s.hunks_removing_or_rewriting_assertions.some((h: any) =>
    h.added_lines.some((l: any) => /toBeDefined\(\)|toBeTruthy\(\)|toThrow\(\)|toBeGreaterThan\(0\)/.test(l.text))),
  NET: s => s.n_with_a_non_local_host > 0,
  SHELL: s => s.added_shell_or_subprocess_sites.some((x: any) => x.interpolates_on_line && !x.argv_form),
  LOOP: s => s.n_such_loops > 0,
};

test("dev discovery finds exactly the five rules, each with a subject; ds discovery is untouched", () => {
  const d = repo("MOCK", "vio");
  const out = evidence(d);
  expect(Object.keys(out).sort()).toEqual([...RULES].sort());
  for (const r of RULES) {
    expect(out[r].subject).toBe("one code change (its diff, tests and scripts)");
    expect(Object.keys(out[r].criteria).sort()).toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
    expect(JSON.stringify(out[r].state).length).toBeLessThan(60000);
  }
  const ds = spawnSync("python3", [join(BASE, "constraints/jev/evidence.py"), "--files", ...changed(d), "--root", d], { encoding: "utf8" });
  const dsOut = JSON.parse(ds.stdout);
  expect(Object.keys(dsOut)).toEqual(["A1", "A4", "DEN", "DQ4", "DQ6", "E7", "M1", "R1", "UNI"]);
  expect(Object.values(dsOut).every((v: any) => v.subject === undefined)).toBe(true);
});

for (const rule of RULES) {
  test(`${rule}: extractor state separates the violating twin from the compliant one`, () => {
    const vio = evidence(repo(rule, "vio"))[rule].state;
    const sat = evidence(repo(rule, "sat"))[rule].state;
    expect(SIGNAL[rule](vio)).toBe(true);
    expect(SIGNAL[rule](sat)).toBe(false);
    // every other rule stays quiet on this rule's fixtures
    for (const other of RULES.filter(r => r !== rule)) {
      expect(SIGNAL[other](evidence(repo(rule, "vio"))[other].state)).toBe(false);
    }
  });
}

test("MOCK state: per-test assertions flagged on_mock", () => {
  const s = evidence(repo("MOCK", "vio")).MOCK.state;
  expect(s.n_changed_tests).toBe(2);
  expect(s.changed_tests[0].assertions[0]).toMatchObject({ text: "expect(tax.rate).toHaveBeenCalledTimes(1)", on_mock: true });
  const sat = evidence(repo("MOCK", "sat")).MOCK.state;
  expect(sat.n_changed_tests).toBe(3);
  expect(sat.changed_tests.every((t: any) => t.n_on_mock === 0 && t.n_assertions === 1)).toBe(true);
});

test("WEAK state: removed and added assertion lines per hunk", () => {
  const s = evidence(repo("WEAK", "vio")).WEAK.state;
  expect(s.hunks_removing_or_rewriting_assertions[0].removed_lines[0].text).toBe("expect(parseKv('a=1,b=2')).toEqual({ a: '1', b: '2' })");
  expect(s.hunks_removing_or_rewriting_assertions[0].added_lines[0].text).toBe("expect(parseKv('a=1,b=2')).toBeDefined()");
  expect(s.n_assertion_lines_removed).toBe(3);
});

test("NET state: hosts classified, local stub recorded", () => {
  const s = evidence(repo("NET", "vio")).NET.state;
  expect(s.network_call_sites[0].hosts).toEqual(["api.github.com"]);
  expect(s.local_stub_servers_or_fakes).toEqual([]);
  const sat = evidence(repo("NET", "sat")).NET.state;
  expect(sat.local_stub_servers_or_fakes[0].text).toBe("const server = Bun.serve({");
});

test("SHELL state: only lines the change added, argv form told apart", () => {
  const s = evidence(repo("SHELL", "vio")).SHELL.state;
  expect(s.n_sites).toBe(1);
  expect(s.added_shell_or_subprocess_sites[0]).toMatchObject({ line: 7, interpolates_on_line: true, argv_form: false });
  expect(evidence(repo("SHELL", "sat")).SHELL.state.added_shell_or_subprocess_sites[0].argv_form).toBe(true);
});

test("LOOP state: the route.ts call sits inside the per-row loop", () => {
  const s = evidence(repo("LOOP", "vio")).LOOP.state;
  expect(s.loops_containing_a_model_route_or_farm_call[0]).toMatchObject({ loop_line: 7, loop: "for (const row of rows) {" });
  const sat = evidence(repo("LOOP", "sat")).LOOP.state;
  expect(sat.n_model_route_farm_lines_in_changed_files).toBe(1);
  expect(sat.n_of_those_inside_a_changed_loop).toBe(0);
});

async function ruleCheck(d: string) {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text());
      const rule = /\(rule (\w+)\)/.exec(body.questions.q0.instructions)![1];
      seen.push(rule);
      const state = JSON.parse(body.state.slice(body.state.indexOf("{")));
      expect(body.state.startsWith("You are auditing one code change (its diff, tests and scripts)")).toBe(true);
      const p = SIGNAL[rule](state) ? 0.95 : 0.05;
      return Response.json({ answers: { q0: { probabilities: { VIOLATED: p }, choice: p > 0.5 ? "VIOLATED" : "SATISFIED" } } });
    },
  });
  // async spawn: a spawnSync would block the event loop the stub answers on
  const proc = Bun.spawn(["bun", join(BASE, "skills/work/scripts/rule-check.ts"), "--project-dir", d, "--rules", RULES_DIR], {
    env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: "test-token", FARM_OUTCOMES: join(d, ".farm-outcomes.jsonl") },
    stdout: "pipe", stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  server.stop(true);
  return { code, out: JSON.parse(stdout.trim().split("\n").pop()!), seen };
}

for (const rule of RULES) {
  test(`${rule}: rule-check blocks the violating twin and passes the compliant one`, async () => {
    const vio = await ruleCheck(repo(rule, "vio"));
    expect(vio.seen.sort()).toEqual([...RULES].sort());
    expect(vio.code).toBe(2);
    expect(vio.out.verdicts.filter((v: any) => v.verdict === "VIOLATED").map((v: any) => v.rule)).toEqual([rule]);
    const sat = await ruleCheck(repo(rule, "sat"));
    expect(sat.code).toBe(0);
    expect(sat.out.verdicts.every((v: any) => v.verdict === "MET")).toBe(true);
  }, 30000);
}
