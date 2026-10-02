import { expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

// The elide-case rules under constraints/jev/elide: extractor state on each rule's fixtures, diff
// scoping, and rule-check.ts --rules against a local stub. No network.

const BASE = join(import.meta.dir, "../../..");
const EVIDENCE = join(BASE, "constraints/jev/evidence.py");
const ELIDE = join(BASE, "constraints/jev/elide");
const FIX = join(BASE, "tests/fixtures/jev/elide");
const TYP = "addenda/03-addendum-salman.typ";

const WIRED = ["EL-EMPH", "EL-GAP", "EL-HOLDING", "EL-NOTE", "EL-VOICE"];

function evidence(rule: string, kase: "sat" | "vio", extra: string[] = []) {
  const root = join(FIX, rule, kase);
  const args = [EVIDENCE, "--files", join(root, TYP), "--root", root, "--rules-dir", ELIDE, ...extra];
  if (fs.existsSync(join(root, "plan.md"))) args.push("--plan", join(root, "plan.md"));
  const r = spawnSync("python3", args, { timeout: 120_000, encoding: "utf8" });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

test("--rules-dir elide discovers exactly the wired EL- rules, each about a casebook excerpt", () => {
  const out = evidence("EL-GAP", "vio");
  expect(Object.keys(out).sort()).toEqual(WIRED);
  for (const id of WIRED) {
    expect(out[id].deliverable).toBe("casebook-excerpt");
    expect(out[id].subject).toContain("casebook excerpt");
    expect(Object.keys(out[id].criteria).sort())
      .toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
  }
});

test("the default rules directory yields no elide rule", () => {
  const root = join(FIX, "EL-GAP", "vio");
  const r = spawnSync("python3", [EVIDENCE, "--files", join(root, TYP), "--root", root], { timeout: 120_000, encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(Object.keys(JSON.parse(r.stdout)).some(k => k.startsWith("EL-"))).toBe(false);
});

const unmarked = (s: any) => s.gaps.filter((g: any) =>
  !(g.a_mark_or_centred_break_immediately_above ?? g.a_mark_or_centred_break_since_the_previous_ordinal)).length;

// [rule, state count] — each violating fixture must yield more candidates than its compliant twin,
// so the judge sees the spans the violation rests on.
const COUNTS: [string, (s: any) => number][] = [
  ["EL-HOLDING", s => s.n_marks_inside_a_sentence],
  ["EL-GAP", unmarked],
  ["EL-VOICE", s => s.n_body_sentences_with_editor_voice_terms],
  ["EL-EMPH", s => s.quotations_stressing_ordinary_words.filter((q: any) => !q.notation_regex_hit_after).length],
  ["EL-NOTE", s => s.reading_notes.reduce((a: number, n: any) => a + n.mechanical_convention_phrases.length, 0)],
];

for (const [rule, count] of COUNTS) {
  test(`${rule}: the violating fixture yields more candidates than the compliant one`, () => {
    const sat = count(evidence(rule, "sat")[rule].state);
    const vio = count(evidence(rule, "vio")[rule].state);
    expect(vio).toBeGreaterThan(sat);
  });
}

test("the compliant twins carry no unmarked gap, no un-noted stress, no editor-voice sentence", () => {
  expect(unmarked(evidence("EL-GAP", "sat")["EL-GAP"].state)).toBe(0);
  const e = evidence("EL-EMPH", "sat")["EL-EMPH"].state;
  expect(e.quotations_stressing_ordinary_words.every((q: any) => q.notation_regex_hit_after)).toBe(true);
  expect(e.n_conventional_italics_in_quotations_set_aside).toBeGreaterThan(0); // Dirks, i.e., quid pro quo
  expect(evidence("EL-VOICE", "sat")["EL-VOICE"].state.n_body_sentences_with_editor_voice_terms).toBe(0);
});

test("EL-HOLDING carries the plan's doctrinal target and the cut holding sentence with its line", () => {
  const s = evidence("EL-HOLDING", "vio")["EL-HOLDING"].state;
  expect(s.doctrinal_target["taught for"]).toBe("holding");
  const lines = s.marks_inside_a_sentence.map((c: any) => [c.file, c.line]);
  expect(lines).toContainEqual([TYP, 59]);
  expect(s.marks_inside_a_sentence.find((c: any) => c.line === 59).sentence)
    .toContain("breaches a fiduciary duty [. . .] and that rule");
});

test("candidate spans are diff-scoped: changed lines that miss the defect yield no candidate", () => {
  const root = join(FIX, "EL-VOICE", "vio");
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "jev-elide-changed-"));
  const changed = join(tmp, "changed.json");
  fs.writeFileSync(changed, JSON.stringify({ [join(root, TYP)]: [[1, 20]] }));
  const scoped = evidence("EL-VOICE", "vio", ["--changed-lines", changed])["EL-VOICE"].state;
  fs.writeFileSync(changed, JSON.stringify({ [join(root, TYP)]: [[1, 200]] }));
  const whole = evidence("EL-VOICE", "vio", ["--changed-lines", changed])["EL-VOICE"].state;
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(scoped.n_body_sentences_with_editor_voice_terms).toBe(0);
  expect(whole.n_body_sentences_with_editor_voice_terms).toBe(2);
});

test("a file outside addenda/ is not an excerpt: no file reaches the rules", () => {
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "jev-elide-notes-"));
  fs.copyFileSync(join(FIX, "EL-VOICE", "vio", TYP), join(tmp, "lecture.typ"));
  const r = spawnSync("python3", [EVIDENCE, "--files", join(tmp, "lecture.typ"), "--root", tmp, "--rules-dir", ELIDE], { timeout: 120_000, encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  const out = JSON.parse(r.stdout);
  for (const id of WIRED) expect(out[id].state.files).toEqual([]);
});

async function ruleCheck(p: number, rule: string, kase: "sat" | "vio") {
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
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "jev-elide-"));
  fs.cpSync(join(FIX, rule, kase), tmp, { recursive: true });
  const args = ["--project-dir", tmp, "--files", TYP, "--rules", ELIDE];
  if (fs.existsSync(join(tmp, "plan.md"))) args.push("--plan", "plan.md");
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
  test(`${rule}: rule-check --rules elide blocks at 0.9 on the violating fixture`, async () => {
    const { res, bodies } = await ruleCheck(0.9, rule, "vio");
    expect(res.exitCode).toBe(2);
    expect(bodies).toHaveLength(WIRED.length);
    expect(bodies.every(b => b.includes("casebook excerpt"))).toBe(true);
    const out = JSON.parse(res.stdout.toString());
    expect(out.verdicts.map((v: any) => v.rule).sort()).toEqual(WIRED);
  });

  test(`${rule}: rule-check --rules elide passes at 0.1 on the compliant fixture`, async () => {
    const { res } = await ruleCheck(0.1, rule, "sat");
    expect(res.exitCode).toBe(0);
  });
}
