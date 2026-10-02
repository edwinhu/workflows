import { expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "path";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";

// The register rules under constraints/jev/legal and constraints/jev/econ, scored on top of
// constraints/jev/writing when a writing run's Domain is legal or econ: extractor state on each
// rule's fixtures, and rule-check.ts --rules <writing> --rules <register> against a local stub. No network.

const BASE = join(import.meta.dir, "../../..");
const EVIDENCE = join(BASE, "constraints/jev/evidence.py");
const WRITING = join(BASE, "constraints/jev/writing");
const LEGAL = join(BASE, "constraints/jev/legal");
const ECON = join(BASE, "constraints/jev/econ");
const FIX = join(BASE, "tests/fixtures/jev");

const WIRED: Record<string, string[]> = {
  [LEGAL]: ["L-DIGEST", "L-FNARG", "L-ID", "L-SUPRA"],
  [ECON]: ["E-CAUSAL", "E-CITEFORM", "E-MAGNITUDE", "E-WEFIND"],
};
const DIR_OF = (rule: string) => (rule.startsWith("L-") ? LEGAL : ECON);

function tmp(prefix: string) {
  return fs.mkdtempSync(join(os.tmpdir(), prefix));
}

function evidenceOn(rulesDir: string, file: string, root: string, changed?: Record<string, number[][]>) {
  const args = [EVIDENCE, "--files", file, "--root", root, "--rules-dir", rulesDir];
  let d = "";
  if (changed) {
    d = tmp("jev-register-changed-");
    fs.writeFileSync(join(d, "c.json"), JSON.stringify(changed));
    args.push("--changed-lines", join(d, "c.json"));
  }
  const r = spawnSync("python3", args, { timeout: 120_000, encoding: "utf8" });
  if (d) fs.rmSync(d, { recursive: true, force: true });
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

function evidence(rule: string, kase: "sat" | "vio", dir = DIR_OF(rule)) {
  const root = join(FIX, rule, kase);
  return evidenceOn(dir, join(root, "test.md"), root);
}

for (const [dir, rules] of Object.entries(WIRED)) {
  test(`${dir.split("/").pop()} discovers exactly its wired rules, uncalibrated/ below the glob`, () => {
    const out = evidence(rules[0], "vio", dir);
    expect(Object.keys(out).sort()).toEqual(rules);
    for (const id of rules) {
      expect(Object.keys(out[id].criteria).sort())
        .toEqual(["INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "SATISFIED", "VIOLATED"]);
      expect(out[id].proposition.length).toBeGreaterThan(80);
    }
  });
}

test("the writing and default directories carry no register rule", () => {
  for (const d of [WRITING, join(BASE, "constraints/jev")]) {
    const out = evidence("L-ID", "vio", d);
    expect(Object.keys(out).some(k => /^[LE]-/.test(k))).toBe(false);
  }
});

// [rule, state count]: each violating fixture yields more candidates than its compliant twin, or the
// same candidates with more of them unanchored, so a judge sees the evidence the violation rests on.
const COUNTS: [string, (s: any) => number][] = [
  ["L-ID", s => s.id_short_forms.filter((x: any) => x.n_antecedent_citation_clauses !== 1).length],
  ["L-FNARG", s => s.discursive_footnotes.reduce((a: number, x: any) => a + x.discursive_words, 0)],
  ["L-DIGEST", s => s.runs_of_case_paragraphs.reduce((a: number, r: any) => a + r.n_paragraphs, 0)],
  ["L-SUPRA", s => s.supra_short_forms.filter((x: any) => x.authority_kind_hint_from_that_clause
    .some((k: string) => ["case", "statute", "bill or other legislative material"].includes(k))).length],
  ["E-WEFIND", s => s.n_listed_with_no_exhibit_in_sentence_neighbours_or_paragraph],
  ["E-CITEFORM", s => s.n_text_citation_candidates + s.n_footnote_citation_candidates],
  ["E-CAUSAL", s => s.n_causal_language_sentences_listed],
  ["E-MAGNITUDE", s => s.n_listed_with_neither_unit_nor_exhibit],
];

for (const [rule, count] of COUNTS) {
  test(`${rule}: the violating fixture yields more candidates than the compliant one`, () => {
    const sat = count(evidence(rule, "sat")[rule].state);
    const vio = count(evidence(rule, "vio")[rule].state);
    expect(vio).toBeGreaterThan(sat);
  });
}

test("L-ID: an Id. after a two-authority footnote, and one after an intervening cite, are both listed with their antecedents", () => {
  const s = evidence("L-ID", "vio")["L-ID"].state;
  const byNote = Object.fromEntries(s.id_short_forms.map((x: any) => [x.footnote, x]));
  expect(byNote[3].antecedent_is).toContain("preceding footnote 2");
  expect(byNote[3].n_antecedent_citation_clauses).toBe(2);
  expect(byNote[4].antecedent_is).toBe("the clause before it in the same footnote");
  expect(byNote[4].antecedent_citation_clauses[0]).toContain("In re MFW");
  for (const x of s.id_short_forms) {
    expect(x.file).toBe("test.md");
    expect(typeof x.line).toBe("number");
  }
});

test("the footnote reader handles Typst: #footnote, #emph[Id.], <label> and #ref resolve to note numbers", () => {
  const d = tmp("jev-register-typ-");
  const f = join(d, "body.typ");
  fs.writeFileSync(f, [
    "= Part I",
    "Monks founded ISS.#footnote[See Hilary Rosenberg, #emph[A Traitor to His Class] 131 (1999) [hereinafter Rosenberg].] <ros>",
    "It had two clients.#footnote[#emph[Id.] at 145.] Its rivals were slower.#footnote[Rosenberg, #emph[supra] note #ref(<ros>), at 120; Kahn v. Lynch Commc'n Sys., Inc., 638 A.2d 1110 (Del. 1994).] Later it grew.#footnote[#emph[Id.] at 150.]",
    "",
  ].join("\n"));
  const s = evidenceOn(LEGAL, f, d)["L-ID"].state;
  fs.rmSync(d, { recursive: true, force: true });
  expect(s.n_footnotes).toBe(4);
  const [first, second] = s.id_short_forms;
  expect(first.footnote).toBe(2);
  expect(first.antecedent_citation_clauses[0]).toContain("Rosenberg, A Traitor to His Class");
  expect(second.footnote).toBe(4);
  expect(second.antecedent_citation_clauses.join(" ")).toContain("Rosenberg, supra note 1, at 120");
  expect(second.n_antecedent_citation_clauses).toBe(2);
});

test("diff scope: only spans on changed lines are listed, and the state says so", () => {
  const root = join(FIX, "E-WEFIND", "vio");
  const file = join(root, "test.md");
  const all = evidenceOn(ECON, file, root)["E-WEFIND"].state;
  const scoped = evidenceOn(ECON, file, root, { [file]: [[11, 11]] })["E-WEFIND"].state;
  expect(all.n_finding_sentences_listed).toBe(6);
  expect(scoped.n_finding_sentences_listed).toBe(1);
  expect(scoped.n_finding_sentences_in_files).toBe(6);
  expect(scoped.finding_sentences[0].line).toBe(11);
  expect(scoped.diff_scope_note).toContain("changed");
});

async function ruleCheck(p: number, rule: string, kase: "sat" | "vio", rules: string[]) {
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
  const d = tmp("jev-register-");
  fs.mkdirSync(join(d, "drafts"));
  fs.copyFileSync(join(FIX, rule, kase, "test.md"), join(d, "drafts", "test.md"));
  const args = ["--project-dir", d, "--files", "drafts/test.md", ...rules.flatMap(r => ["--rules", r])];
  const res = await $`bun run ${join(import.meta.dir, "rule-check.ts")} ${args}`
    .env({
      ...process.env,
      WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`,
      WORK_HOLD_JUDGE_TOKEN: "test-token",
      FARM_OUTCOMES: join(d, "outcomes.jsonl"),
    })
    .cwd(d).nothrow().quiet();
  server.stop(true);
  fs.rmSync(d, { recursive: true, force: true });
  return { res, bodies };
}

for (const rule of Object.values(WIRED).flat()) {
  test(`${rule}: rule-check --rules <register> blocks at 0.9 on the violating fixture`, async () => {
    const { res, bodies } = await ruleCheck(0.9, rule, "vio", [DIR_OF(rule)]);
    expect(res.exitCode).toBe(2);
    expect(bodies).toHaveLength(WIRED[DIR_OF(rule)].length);
    expect(bodies.some(b => b.includes(`rule ${rule}`))).toBe(true);
  });

  test(`${rule}: rule-check --rules <register> passes at 0.1 on the compliant fixture`, async () => {
    const { res } = await ruleCheck(0.1, rule, "sat", [DIR_OF(rule)]);
    expect(res.exitCode).toBe(0);
  });
}

test("--rules repeats: writing plus legal scores both sets in one run", async () => {
  const { res, bodies } = await ruleCheck(0.9, "L-ID", "vio", [WRITING, LEGAL]);
  expect(res.exitCode).toBe(2);
  const out = JSON.parse(res.stdout.toString());
  expect(out.verdicts.map((v: any) => v.rule).sort())
    .toEqual(["L-DIGEST", "L-FNARG", "L-ID", "L-SUPRA", "W-ATTRIB", "W-HEDGE", "W-SIGNPOST"]);
  expect(bodies).toHaveLength(7);
  expect(bodies.filter(b => b.includes("law review deliverable")).length).toBe(4);
});
