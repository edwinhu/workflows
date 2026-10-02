import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { changedFiles, changedRanges, collectEvidence } from "./rule-check.ts";

// The authoring rules against their fixture twins, replayed as a before/ commit and an after/ working
// tree so the extractors see exactly the lines a change added. Fixture files carry a .fixture suffix
// so no probe mistakes a fixture SKILL.md for a skill of this plugin.
const BASE = join(import.meta.dir, "../../..");
const RULES_DIR = join(BASE, "constraints/jev/authoring");
const UNCAL_DIR = join(RULES_DIR, "uncalibrated");
const FIX = join(BASE, "tests/fixtures/jev/authoring");
const RULES = ["A-DESC", "A-FLAG", "A-GATE", "A-SOFT", "A-STATE"] as const;
const SUBJECT = "one skill, plugin or workflow authoring change (SKILL.md, agent .md, manifests, .planning/ files)";
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

function git(d: string, ...a: string[]) {
  return spawnSync("git", ["-C", d, ...a], { timeout: 120_000, encoding: "utf8" });
}

function replay(before: string | null, after: string): string {
  const d = mkdtempSync(join(tmpdir(), "jev-authoring-"));
  made.push(d);
  git(d, "init", "-q");
  git(d, "config", "user.email", "t@t");
  git(d, "config", "user.name", "t");
  if (before && existsSync(before)) cpSync(before, d, { recursive: true });
  stripSuffix(d);
  git(d, "add", "-A");
  git(d, "commit", "-qm", "before", "--allow-empty");
  cpSync(after, d, { recursive: true });
  stripSuffix(d);
  return d;
}

const repo = (rule: string, twin: "vio" | "sat") => replay(join(FIX, rule, twin, "before"), join(FIX, rule, twin, "after"));

function evidence(d: string, rulesDir = RULES_DIR): Record<string, any> {
  return collectEvidence({ files: changedFiles(d), root: d, changed: changedRanges(d), rulesDir });
}

// One deterministic reading of each rule's state, standing in for Jev so the test pins the wiring
// (the right spans reach Jev, p drives the exit), not the model.
const SIGNAL: Record<string, (s: any) => boolean> = {
  "A-DESC": s => s.changed_descriptions.some((d: any) => d.clauses.some((c: any) => /\b(phases?|first|then|dispatch\w*|runs)\b/i.test(c))),
  "A-FLAG": s => s.n_with_intention_words_in_trigger > 0,
  "A-GATE": s => s.n_naming_no_decidable_check > 0,
  "A-SOFT": s => s.n_with_soft_words > 0,
  "A-STATE": s => s.planning_files_in_change.some((p: any) => !p.canonical_name) && s.files_deleted_by_change.length === 0,
  "A-PAD": s => s.added_passages.some((p: any) => p.history_markers.length > 0 && !p.carries_a_number),
};

test("authoring discovery finds exactly the five wired rules, each with the authoring subject", () => {
  const out = evidence(repo("A-DESC", "vio"));
  expect(Object.keys(out).sort()).toEqual([...RULES].sort());
  for (const r of RULES) {
    expect(out[r].subject).toBe(SUBJECT);
    expect(out[r].deliverable).toBe("authoring");
    expect(Object.keys(out[r].criteria).sort()).toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
    expect(JSON.stringify(out[r].state).length).toBeLessThan(60000);
  }
  // uncalibrated/ sits below the glob rule-check reads; it is reached only by naming it
  expect(Object.keys(evidence(repo("A-PAD", "vio"), UNCAL_DIR))).toEqual(["A-PAD"]);
});

for (const rule of [...RULES, "A-PAD"]) {
  test(`${rule}: extractor state separates the violating twin from the compliant one`, () => {
    const dir = rule === "A-PAD" ? UNCAL_DIR : RULES_DIR;
    const vio = evidence(repo(rule, "vio"), dir);
    expect(SIGNAL[rule](vio[rule].state)).toBe(true);
    expect(SIGNAL[rule](evidence(repo(rule, "sat"), dir)[rule].state)).toBe(false);
    // every wired rule other than this one stays quiet on this rule's violating twin
    const all = evidence(repo(rule, "vio"));
    for (const other of RULES.filter(r => r !== rule)) expect(SIGNAL[other](all[other].state)).toBe(false);
  });
}

test("A-DESC state: the changed description arrives split into clauses, with its line", () => {
  const s = evidence(repo("A-DESC", "vio"))["A-DESC"].state;
  expect(s.n_changed_descriptions).toBe(1);
  expect(s.changed_descriptions[0]).toMatchObject({ file: "skills/csv-audit/SKILL.md", line: 3, name: "csv-audit", kind: "skill" });
  expect(s.changed_descriptions[0].clauses[0]).toStartWith("Audits a CSV in three phases");
  // a body-only change leaves the description out of the state
  expect(evidence(repo("A-FLAG", "vio"))["A-DESC"].state.n_changed_descriptions).toBe(0);
});

test("A-FLAG state: a table row's first cell is the trigger", () => {
  const s = evidence(repo("A-FLAG", "vio"))["A-FLAG"].state;
  expect(s.n_with_intention_words_in_trigger).toBe(3);
  expect(s.changed_red_flags[0].trigger).toBe("If you catch yourself thinking the blank rows are probably harmless");
  const sat = evidence(repo("A-FLAG", "sat"))["A-FLAG"].state;
  expect(sat.changed_red_flags.filter((f: any) => f.trigger.startsWith("About to")).length).toBe(3);
});

test("A-STATE state: a new .planning noun and the lines naming it; nothing retired", () => {
  const s = evidence(repo("A-STATE", "vio"))["A-STATE"].state;
  expect(s.planning_files_in_change).toEqual([expect.objectContaining({ file: ".planning/CSV-NOTES.md", canonical_name: false, created_or_rewritten_whole: true })]);
  expect(s.added_lines_writing_or_naming_state.flatMap((w: any) => w.paths_named)).toEqual([".planning/CSV_AUDITED.json", ".planning/CSV-NOTES.md"]);
  expect(s.files_deleted_by_change).toEqual([]);
});

test("diff scope: a violation already in the before tree is not the change's", () => {
  // before carries the intention-targeted red flags; the change only appends a compliant gate
  const vioAfter = join(FIX, "A-FLAG", "vio", "after");
  const d = replay(vioAfter, vioAfter);
  const page = join(d, "skills/csv-audit/SKILL.md");
  writeFileSync(page, readFileSync(page, "utf8") + "\n## Gate\n\nProceed only when `bun scripts/report-lint.ts REPORT.md` exits 0.\n");
  const out = evidence(d);
  expect(out["A-FLAG"].state.n_changed_red_flags).toBe(0);
  expect(out["A-GATE"].state.n_changed_gate_or_loop_passages).toBe(1);
  expect(out["A-GATE"].state.n_naming_no_decidable_check).toBe(0);
});

async function ruleCheck(d: string) {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text());
      const rule = /\(rule ([\w-]+)\)/.exec(body.questions.q0.instructions)![1];
      seen.push(rule);
      expect(body.state.startsWith(`You are auditing ${SUBJECT}`)).toBe(true);
      const state = JSON.parse(body.state.slice(body.state.indexOf("{")));
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
