import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

// checks/workshop/rules, deterministic parts only (no model): every rule's metadata, calibration manifest
// entry, diff scoping and kind scoping, each asserted on a violating input AND a compliant one.
const ROOT = join(import.meta.dir, "..");
const EVIDENCE = join(ROOT, "checks/_jev/evidence.py");
const WIRED_DIR = join(ROOT, "checks/workshop/rules");
const UNCAL_DIR = join(WIRED_DIR, "uncalibrated");
const FIX = join(ROOT, "tests/fixtures/jev/typst");
setDefaultTimeout(300_000);
const made: string[] = [];
afterAll(() => made.forEach(d => rmSync(d, { recursive: true, force: true })));

// rule -> [rules dir, fixture file, kind, state list key whole-file, state list key under diff info]
const RULES: Record<string, [string, string, "deck" | "notes", string, string]> = {
  "T-CALLOUT": [WIRED_DIR, "slides.typ", "deck", "callouts", "callouts"],
  "T-STORY": [WIRED_DIR, "slides.typ", "deck", "storytelling_comments", "storytelling_comments"],
  "T-TAKEAWAY": [WIRED_DIR, "slides.typ", "deck", "subtitles", "added_subtitles"],
  "T-HOLLOW": [WIRED_DIR, "notes.typ", "notes", "announcing_bullets", "announcing_bullets"],
  "T-TRANSITION": [WIRED_DIR, "notes.typ", "notes", "sections_after_the_first", "added_sections"],
  "T-ECHO-PARA": [UNCAL_DIR, "slides.typ", "deck", "slides_subtitle_and_first_body_line", "slides_subtitle_and_first_body_line"],
  "T-TAKEAWAY-WH": [UNCAL_DIR, "slides.typ", "deck", "wh_subtitles", "added_wh_subtitles"],
};

function run(rule: string, file: string, root: string, changed?: Record<string, number[][]>) {
  const args = [EVIDENCE, "--rules-dir", RULES[rule][0], "--root", root, "--files", file];
  if (changed) {
    const d = mkdtempSync(join(tmpdir(), "wsrules-"));
    made.push(d);
    writeFileSync(join(d, "c.json"), JSON.stringify(changed));
    args.push("--changed-lines", join(d, "c.json"));
  }
  const r = spawnSync("python3", args, { timeout: 120_000, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout)[rule];
}
const vioFile = (rule: string) => join(FIX, rule, "vio", RULES[rule][1]);
const satFile = (rule: string) => join(FIX, rule, "sat", RULES[rule][1]);
const listed = (out: any, key: string) => (out.state[key] ?? []).length;

for (const rule of Object.keys(RULES)) {
  const [, , kind, key, addedKey] = RULES[rule];

  test(`${rule}: declares a proposition, the four verdict criteria and the typst deliverable`, () => {
    const out = run(rule, vioFile(rule), join(FIX, rule, "vio"));
    expect(out.proposition.length).toBeGreaterThan(80);
    expect(Object.keys(out.criteria).sort()).toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
    for (const v of Object.values(out.criteria)) expect((v as string).length).toBeGreaterThan(10);
    expect(out.deliverable).toBe("typst");
    // the explicit-absence key: a covered file that examined nothing is UNAVAILABLE, so the key must be in the state
    expect(out.examinedKey).toBe("n_lines_searched");
    expect(out.examined).toBeGreaterThan(0);
  });

  test(`${rule}: the manifest holds a violating and a compliant case whose paths exist`, () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/jev/calibration.json"), "utf8"));
    const cases: { kind: string; path: string }[] = manifest.sets.typst.rules[rule];
    expect(cases, `calibration.json typst set lists ${rule}`).toBeDefined();
    for (const k of ["violating", "compliant"]) expect(cases.some(c => c.kind === k), `${rule}: a ${k} case`).toBe(true);
    for (const c of cases) expect(existsSync(join(ROOT, c.path)), c.path).toBe(true);
    expect(cases.map(c => c.path)).toContain(`tests/fixtures/jev/typst/${rule}/vio`);
    expect(cases.map(c => c.path)).toContain(`tests/fixtures/jev/typst/${rule}/sat`);
  });

  test(`${rule}: diff scope lists the span when its lines changed and none, counted, when they did not`, () => {
    const root = join(FIX, rule, "vio");
    const f = vioFile(rule);
    const hit = run(rule, f, root, { [f]: [[1, 9999]] });
    expect(listed(hit, addedKey), "changed lines cover the violating span").toBeGreaterThan(0);
    const miss = run(rule, f, root, { [f]: [[9999, 9999]] });
    expect(listed(miss, addedKey), "changed lines elsewhere").toBe(0);
    if (miss.state.n_skipped_unchanged !== undefined) expect(miss.state.n_skipped_unchanged).toBeGreaterThan(0);
  });

  // T-CALLOUT and T-STORY read any .typ; the rest read one kind, decided by the file's name
  if (!["T-CALLOUT", "T-STORY"].includes(rule)) test(`${rule}: its own violating fixture renamed to the other kind lists nothing`, () => {
    const d = mkdtempSync(join(tmpdir(), "wsrules-kind-"));
    made.push(d);
    const flipped = join(d, kind === "deck" ? "notes.typ" : "slides.typ");
    writeFileSync(flipped, readFileSync(vioFile(rule), "utf8"));
    expect(listed(run(rule, flipped, d), key)).toBe(0);
    const same = join(d, kind === "deck" ? "slides.typ" : "notes.typ");
    writeFileSync(same, readFileSync(vioFile(rule), "utf8"));
    expect(listed(run(rule, same, d), key), "the same text under its own kind's name").toBeGreaterThan(0);
  });

  test(`${rule}: the violating twin lists a span and the compliant twin differs from it`, () => {
    const v = run(rule, vioFile(rule), join(FIX, rule, "vio"));
    const s = run(rule, satFile(rule), join(FIX, rule, "sat"));
    expect(listed(v, key)).toBeGreaterThan(0);
    expect(JSON.stringify(v.state)).not.toBe(JSON.stringify(s.state));
  });
}
