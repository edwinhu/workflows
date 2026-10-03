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
const WIRED = ["T-CALLOUT", "T-HOLLOW", "T-STORY", "T-TAKEAWAY", "T-TRANSITION"];
const UNWIRED = ["T-ECHO-PARA", "T-TAKEAWAY-WH"];
const made: string[] = [];
afterAll(() => made.forEach(d => rmSync(d, { recursive: true, force: true })));

const FILE: Record<string, string> = {
  "T-TAKEAWAY": "slides.typ", "T-TAKEAWAY-WH": "slides.typ", "T-ECHO-PARA": "slides.typ", "T-STORY": "slides.typ", "T-CALLOUT": "slides.typ",
  "T-HOLLOW": "notes.typ", "T-TRANSITION": "notes.typ",
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

test("--rules-dir typst discovers exactly the wired rules; uncalibrated/ holds the rest", () => {
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
    // the subtitle alone: the body's first lines state the claim a label omits
    expect(Object.keys(v.subtitles[0]).sort()).toEqual(["file", "line", "opens_with_ing_word", "subtitle"]);
  },
  "T-TAKEAWAY-WH": (v, s) => {
    expect(v.wh_subtitles).toEqual([{ file: "slides.typ", line: 16, subtitle: "What made proxy advisors powerful.",
      framed: "This slide explains what made proxy advisors powerful." }]);
    // the frame is built by the extractor, so the judge rules on grammaticality, not on constructing it
    expect(s.wh_subtitles[0].framed).toBe("This slide explains what made proxy advisors powerful was the SEC's 2003 voting-duty rule.");
  },
  "T-ECHO-PARA": (v, s) => {
    // the paraphrase shares one word, under no-subtitle-echo.py's threshold; the second slide adds numbers
    expect(v.slides_subtitle_and_first_body_line).toEqual([{
      file: "slides.typ", line: 10, subtitle: "Boards rarely fire a CEO after one bad year.",
      first_body_line: { line: 13, text: "Directors seldom dismiss a chief executive following a single poor year." },
      script_overlap_share: 0.12,
    }]);
    expect(s.slides_subtitle_and_first_body_line[0].script_overlap_share).toBe(0);
    expect([v.n_slides_listed, s.n_slides_listed]).toEqual([1, 1]);
  },
  "T-STORY": (v, s) => {
    expect(v.storytelling_comments[0]).toMatchObject({ line: 14, names_visual_property: false, states_audience_conclusion: false });
    expect(v.storytelling_comments[0].diagram_call).toEqual({ line: 15, call: "fletcher-diagram" });
    expect(v.n_comments_missing_mechanism_or_insight).toBe(1);
    expect(s.storytelling_comments[0]).toMatchObject({ names_visual_property: true, states_audience_conclusion: true });
    expect(s.n_comments_missing_mechanism_or_insight).toBe(0);
  },
  "T-CALLOUT": (v, s) => {
    expect(v.callouts).toHaveLength(1);
    expect(v.callouts[0]).toMatchObject({ line: 15, has_quotation_marks: true });
    expect(s.callouts[0].has_quotation_marks).toBe(false);
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
    expect(v.sections_after_the_first[0].first_bullet.text).toStartWith("Several studies have examined");
    expect(v.sections_after_the_first[0]).toMatchObject({ turn_cues: [], asks_question: false, names_previous_section: [] });
    expect(v.sections_after_the_first[0].previous_section_last_sentence).toBe("That concentration is the reason anyone worries about their influence at all.");
    expect(v.sections_after_the_first[0]).toMatchObject({ repeats_from_last_sentence: [], opens_on_pointer: null });
    expect(s.sections_after_the_first[0]).not.toHaveProperty("previous_section_last_sentence");
    expect(s.sections_after_the_first[0].first_bullet.text).toStartWith("So the market is concentrated.");
    expect(s.sections_after_the_first[0]).toMatchObject({ turn_cues: ["so"], asks_question: true });
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
  const onNotes = evidence(TYPST, [join(notes, "notes.typ")], notes);
  expect(onNotes["T-TAKEAWAY"].state.n_subtitles).toBe(0);
  expect(onNotes["T-TAKEAWAY"].state.files_not_of_this_kind).toEqual(["notes.typ"]);
  const onDeck = evidence(TYPST, [join(deck, "slides.typ")], deck);
  expect(onDeck["T-HOLLOW"].state.n_announcing_bullets).toBe(0);
  expect(onDeck["T-HOLLOW"].state.notes_files_examined).toEqual([]);
});

test("T-TAKEAWAY defers a wh-opening subtitle without `?` to T-TAKEAWAY-WH, which lists only those", () => {
  const root = join(FIX, "T-TAKEAWAY-WH", "vio");
  const wired = evidence(TYPST, [join(root, "slides.typ")], root)["T-TAKEAWAY"].state;
  expect(wired.subtitles.map((x: any) => x.subtitle)).toEqual(["Two firms advise holders of most of the shares voted at U.S. annual meetings."]);
  expect(wired.n_wh_subtitles_judged_by_T_TAKEAWAY_WH).toBe(1);
  expect(state("T-TAKEAWAY-WH", "vio").n_wh_subtitles).toBe(1);
  expect(state("T-TAKEAWAY-WH", "sat").n_wh_subtitles).toBe(1);
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
  expect(sat.out.verdicts.map((v: any) => v.verdict)).toEqual(WIRED.map(() => "MET"));
}, 30000);
