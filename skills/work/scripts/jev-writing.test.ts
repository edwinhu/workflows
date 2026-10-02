import { expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

// The writing rules under constraints/jev/writing: extractor state on each rule's fixtures, and
// rule-check.ts --rules against a local stub. No network.

const BASE = join(import.meta.dir, "../../..");
const EVIDENCE = join(BASE, "constraints/jev/evidence.py");
const WRITING = join(BASE, "constraints/jev/writing");
const UNCALIBRATED = join(WRITING, "uncalibrated");
const FIX = join(BASE, "tests/fixtures/jev");

const WIRED = ["W-ATTRIB", "W-HEDGE", "W-SIGNPOST"];

function evidence(rulesDir: string | null, rule: string, kase: "sat" | "vio") {
  const root = join(FIX, rule, kase);
  const args = [EVIDENCE, "--files", join(root, "test.md"), "--root", root];
  if (rulesDir) args.push("--rules-dir", rulesDir);
  const r = spawnSync("python3", args, { encoding: "utf8" });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

test("--rules-dir writing discovers exactly the wired W- rules, each a prose rule", () => {
  const out = evidence(WRITING, "W-HEDGE", "vio");
  expect(Object.keys(out).sort()).toEqual(WIRED);
  for (const id of WIRED) {
    expect(out[id].deliverable).toBe("prose");
    expect(Object.keys(out[id].criteria).sort())
      .toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
  }
});

test("the default rules directory still yields the ten ds rules and no writing rule", () => {
  const out = evidence(null, "W-HEDGE", "vio");
  expect(Object.keys(out)).toHaveLength(10);
  expect(Object.keys(out).some(k => k.startsWith("W-"))).toBe(false);
});

// [rule, rules dir, state count] — each violating fixture must yield more candidates than its
// compliant twin, so a judge sees the evidence the violation rests on.
const COUNTS: [string, string, (s: any) => number][] = [
  ["W-SIGNPOST", WRITING, s => s.n_signpost_candidates],
  ["W-HEDGE", WRITING, s => s.n_sentences_with_two_or_more_hedges],
  ["W-ATTRIB", WRITING, s => s.n_vague_attributions + s.n_statistics_without_a_source_marker],
  ["W-FIGURES", UNCALIBRATED, s => s.n_contrast_candidates + s.paragraph_closers.length],
  ["W-BULLETS", UNCALIBRATED, s => s.lists.reduce((a: number, l: any) => a + l.items_opening_on_a_connective, 0)],
];

for (const [rule, dir, count] of COUNTS) {
  test(`${rule}: the violating fixture yields more candidates than the compliant one`, () => {
    const sat = count(evidence(dir, rule, "sat")[rule].state);
    const vio = count(evidence(dir, rule, "vio")[rule].state);
    expect(vio).toBeGreaterThan(sat);
  });
}

test("the compliant fixtures carry no stacked hedge, no vague attribution, no connective list", () => {
  expect(evidence(WRITING, "W-HEDGE", "sat")["W-HEDGE"].state.n_sentences_with_two_or_more_hedges).toBe(0);
  const a = evidence(WRITING, "W-ATTRIB", "sat")["W-ATTRIB"].state;
  expect(a.n_vague_attributions + a.n_statistics_without_a_source_marker).toBe(0);
  const b = evidence(UNCALIBRATED, "W-BULLETS", "sat")["W-BULLETS"].state;
  expect(b.lists.every((l: any) => l.items_opening_on_a_connective === 0)).toBe(true);
});

test("candidate spans carry file:line", () => {
  const s = evidence(WRITING, "W-SIGNPOST", "vio")["W-SIGNPOST"].state;
  for (const c of s.signpost_candidates) {
    expect(c.file).toBe("test.md");
    expect(typeof c.line).toBe("number");
  }
});

async function ruleCheck(p: number, rule: string, kase: "sat" | "vio", rules: string | null) {
  const bodies: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      bodies.push(await req.text());
      return new Response(JSON.stringify({
        answers: { q0: { probabilities: { VIOLATED: p }, choice: p >= 0.5 ? "VIOLATED" : "MET" } },
      }));
    },
  });
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "jev-writing-"));
  fs.mkdirSync(join(tmp, "drafts"));
  fs.copyFileSync(join(FIX, rule, kase, "test.md"), join(tmp, "drafts", "test.md"));
  const args = ["--project-dir", tmp, "--files", "drafts/test.md"];
  if (rules) args.push("--rules", rules);
  const res = await $`bun run ${join(import.meta.dir, "rule-check.ts")} ${args}`
    .env({
      ...process.env,
      WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`,
      WORK_HOLD_JUDGE_TOKEN: "test-token",
      FARM_OUTCOMES: join(tmp, "outcomes.jsonl"),
    })
    .cwd(tmp).nothrow().quiet();
  server.stop(true);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { res, bodies };
}

for (const rule of WIRED) {
  test(`${rule}: rule-check --rules writing blocks at 0.9 on the violating fixture`, async () => {
    const { res, bodies } = await ruleCheck(0.9, rule, "vio", WRITING);
    expect(res.exitCode).toBe(2);
    expect(bodies).toHaveLength(WIRED.length);
    const out = JSON.parse(res.stdout.toString());
    expect(out.verdicts.map((v: any) => v.rule).sort()).toEqual(WIRED);
  });

  test(`${rule}: rule-check --rules writing passes at 0.1 on the compliant fixture`, async () => {
    const { res } = await ruleCheck(0.1, rule, "sat", WRITING);
    expect(res.exitCode).toBe(0);
  });
}

test("the writing preamble names a prose deliverable; the default still names data science", async () => {
  const w = await ruleCheck(0.1, "W-HEDGE", "vio", WRITING);
  expect(w.bodies.every(b => b.includes("prose deliverable"))).toBe(true);
  const d = await ruleCheck(0.1, "W-HEDGE", "vio", null);
  expect(d.bodies.length).toBeGreaterThan(0);
  expect(d.bodies.every(b => b.includes("data-science deliverable"))).toBe(true);
});
