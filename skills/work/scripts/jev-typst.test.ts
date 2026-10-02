import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// The Typst deck/notes rules under constraints/jev/typst: extractor state on every rule's fixture
// twins (wired and uncalibrated), diff scoping, and rule-check.ts --rules against a stub Jev. No network.
const BASE = join(import.meta.dir, "../../..");
const EVIDENCE = join(BASE, "constraints/jev/evidence.py");
const TYPST = join(BASE, "constraints/jev/typst");
const UNCAL = join(TYPST, "uncalibrated");
const FIX = join(BASE, "tests/fixtures/jev/typst");
const WIRED = ["T-CALLOUT", "T-HOLLOW", "T-STORY"];
const UNWIRED = ["T-ECHO", "T-NARRATE", "T-TAKEAWAY", "T-TRANSITION"];
const made: string[] = [];
afterAll(() => made.forEach(d => rmSync(d, { recursive: true, force: true })));

const FILE: Record<string, string> = {
  "T-TAKEAWAY": "slides.typ", "T-ECHO": "slides.typ", "T-STORY": "slides.typ", "T-CALLOUT": "slides.typ",
  "T-NARRATE": "notes.typ", "T-HOLLOW": "notes.typ", "T-TRANSITION": "notes.typ",
};

function evidence(dir: string, files: string[], root: string, changed?: Record<string, number[][]>) {
  const args = [EVIDENCE, "--rules-dir", dir, "--root", root, "--files", ...files];
  if (changed) {
    const d = mkdtempSync(join(tmpdir(), "jev-typst-changed-"));
    made.push(d);
    writeFileSync(join(d, "c.json"), JSON.stringify(changed));
    args.push("--changed-lines", join(d, "c.json"));
  }
  const r = spawnSync("python3", args, { timeout: 120_000, encoding: "utf8" });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

function state(rule: string, kase: "vio" | "sat", changed?: Record<string, number[][]>) {
  const root = join(FIX, rule, kase);
  const dir = WIRED.includes(rule) ? TYPST : UNCAL;
  return evidence(dir, [join(root, FILE[rule])], root, changed)[rule].state;
}

test("--rules-dir typst discovers exactly the wired rules; uncalibrated/ holds the other four", () => {
  const root = join(FIX, "T-HOLLOW", "vio");
  const out = evidence(TYPST, [join(root, "notes.typ")], root);
  expect(Object.keys(out).sort()).toEqual(WIRED);
  for (const r of WIRED) {
    expect(out[r].deliverable).toBe("typst");
    expect(out[r].subject).toBe("one Typst slide deck and its speaker notes");
    expect(Object.keys(out[r].criteria).sort()).toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
  }
  expect(Object.keys(evidence(UNCAL, [join(root, "notes.typ")], root)).sort()).toEqual(UNWIRED);
});

// What each violating twin carries that its compliant twin does not, read off the state.
const SEPARATES: Record<string, (vio: any, sat: any) => void> = {
  "T-TAKEAWAY": (v, s) => {
    expect(v.subtitles.map((x: any) => x.subtitle)).toContain("Proxy Advisors Overview");
    expect(s.subtitles.map((x: any) => x.subtitle)).not.toContain("Proxy Advisors Overview");
  },
  "T-ECHO": (v, s) =>
    expect(v.slides_subtitle_and_first_body_line[0].share_of_subtitle_words)
      .toBeGreaterThan(s.slides_subtitle_and_first_body_line[0].share_of_subtitle_words),
  "T-STORY": (v, s) => {
    expect(v.storytelling_comments[0]).toMatchObject({ line: 14, has_arrow_separator: false });
    expect(v.storytelling_comments[0].diagram).toMatchObject({ call: "fletcher-diagram", n_placed_labels: 4, n_edges_or_lines: 3 });
    expect(s.storytelling_comments[0].has_arrow_separator).toBe(true);
  },
  "T-CALLOUT": (v, s) => {
    expect(v.callouts).toHaveLength(1);
    expect(v.callouts[0]).toMatchObject({ line: 15, has_quotation_marks: true });
    expect(s.callouts[0].has_quotation_marks).toBe(false);
  },
  "T-NARRATE": (v, s) => {
    expect(v.bullets_mentioning_a_visual.map((b: any) => b.line)).toEqual([12, 14]);
    expect(s.n_bullets_mentioning_a_visual).toBe(0);
  },
  "T-HOLLOW": (v, s) => {
    expect(v.announcing_bullets).toHaveLength(1);
    expect(v.announcing_bullets[0]).toMatchObject({ file: "notes.typ", line: 12, announcing_phrase: "walk through" });
    expect(v.announcing_bullets[0].following_bullets[0].text).toBe("So the effect is not an artifact of selection.");
    // the compliant twin announces three ways and then writes each one out
    expect(s.announcing_bullets[0].following_bullets).toHaveLength(4);
    expect(s.announcing_bullets[0].following_bullets[0].text).toStartWith("First,");
  },
  "T-TRANSITION": (v, s) => {
    expect(v.sections_after_the_first[0]).toMatchObject({ line: 16, section: "Empirical Evidence" });
    expect(v.sections_after_the_first[0].first_bullets[0].text).toStartWith("Several studies have examined");
    expect(s.sections_after_the_first[0].first_bullets[0].text).toStartWith("So the market is concentrated.");
  },
};

for (const rule of [...WIRED, ...UNWIRED]) {
  test(`${rule}: extractor state separates the violating twin from the compliant one`, () => {
    SEPARATES[rule](state(rule, "vio"), state(rule, "sat"));
  });
}

test("deck rules find nothing in a notes file and notes rules nothing in a deck", () => {
  const notes = join(FIX, "T-HOLLOW", "vio");
  const deck = join(FIX, "T-TAKEAWAY", "vio");
  const onNotes = evidence(UNCAL, [join(notes, "notes.typ")], notes);
  expect(onNotes["T-TAKEAWAY"].state.n_subtitles).toBe(0);
  expect(onNotes["T-TAKEAWAY"].state.files_not_of_this_kind).toEqual(["notes.typ"]);
  const onDeck = evidence(TYPST, [join(deck, "slides.typ")], deck);
  expect(onDeck["T-HOLLOW"].state.n_announcing_bullets).toBe(0);
  expect(onDeck["T-HOLLOW"].state.notes_files_examined).toEqual([]);
});

test("diff scope: a span on unchanged lines is skipped, counted, and never listed", () => {
  const root = join(FIX, "T-HOLLOW", "vio");
  const notes = join(root, "notes.typ");
  const out = state("T-HOLLOW", "vio", { [notes]: [[14, 16]] });
  expect(out.n_announcing_bullets).toBe(0);
  expect(out.n_skipped_unchanged).toBe(1);
  expect(out.diff_scope_note).toContain("never a violation");
  expect(state("T-HOLLOW", "vio", { [notes]: [[12, 12]] }).n_announcing_bullets).toBe(1);
});

test("stage directions in brackets are not spoken, so T-NARRATE sets them aside", () => {
  const d = mkdtempSync(join(tmpdir(), "jev-typst-stage-"));
  made.push(d);
  writeFileSync(join(d, "notes.typ"), "== A\n\n- [Pause here; the slide shows the table.]\n\n- [Answer: the slide shows it.]\n");
  const s = evidence(UNCAL, [join(d, "notes.typ")], d)["T-NARRATE"].state;
  expect(s.n_bracketed_stage_directions_not_spoken).toBe(1);
  expect(s.bullets_mentioning_a_visual.map((b: any) => b.line)).toEqual([5]);
});

// The stub reads the T-HOLLOW state and answers VIOLATED when an announcing bullet's next bullet does
// not open with an ordinal: one deterministic reading, so the test pins the wiring, not the model.
async function ruleCheck(kase: "vio" | "sat") {
  const d = mkdtempSync(join(tmpdir(), `jev-typst-${kase}-`));
  made.push(d);
  // a repo with an empty first commit: --project-dir reads the round's files as untracked changes
  const git = (...a: string[]) => spawnSync("git", ["-C", d, ...a], { timeout: 120_000, encoding: "utf8" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "before", "--allow-empty");
  cpSync(join(FIX, "T-HOLLOW", kase), join(d, "presentation"), { recursive: true });
  writeFileSync(join(d, "presentation", "slides.pdf"), "%PDF-1.4 not a deck the extractor reads\n");
  const seen: string[] = [];
  let preamble = "";
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text());
      const rule = /\(rule ([\w-]+)\)/.exec(body.questions.q0.instructions)![1];
      seen.push(rule);
      preamble = body.state.slice(0, 200);
      const s = JSON.parse(body.state.slice(body.state.indexOf("{")));
      // the deck rules find no callout or storytelling comment in a notes-only round
      const hollow = rule === "T-HOLLOW" && s.announcing_bullets.some((b: any) => !/^(First|Second|Third)\b/.test(b.following_bullets[0]?.text ?? ""));
      const p = hollow ? 0.95 : 0.05;
      return Response.json({ answers: { q0: { probabilities: { VIOLATED: p }, choice: p > 0.5 ? "VIOLATED" : "SATISFIED" } } });
    },
  });
  // async spawn: a spawnSync would block the event loop the stub answers on
  const proc = Bun.spawn(["bun", join(BASE, "skills/work/scripts/rule-check.ts"), "--project-dir", d, "--rules", TYPST], {
    env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: "test-token", FARM_OUTCOMES: join(d, ".farm-outcomes.jsonl") },
    stdout: "pipe", stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  server.stop(true);
  return { code, out: JSON.parse(stdout.trim().split("\n").pop()!), seen, preamble };
}

test("T-HOLLOW: rule-check --rules typst blocks the violating notes and passes the compliant ones", async () => {
  const vio = await ruleCheck("vio");
  expect(vio.seen.sort()).toEqual(WIRED);
  expect(vio.preamble).toStartWith("You are auditing one Typst slide deck and its speaker notes against a written RULE.");
  expect(vio.code).toBe(2);
  expect(vio.out.verdicts.filter((v: any) => v.verdict === "VIOLATED")).toMatchObject([{ rule: "T-HOLLOW" }]);
  const sat = await ruleCheck("sat");
  expect(sat.code).toBe(0);
  expect(sat.out.verdicts.map((v: any) => v.verdict)).toEqual(["MET", "MET", "MET"]);
}, 30000);
