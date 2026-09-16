// Specification for scripts/check.sh — the single mechanical verdict for an addendum.
//
// HERMETIC. Every fixture is built from ../fixtures/ and copied into a temp dir. Nothing
// here reads a course repo: a suite whose fixture source is a file the user edits at will
// tests a coincidence between these scripts and that file's shape today, not the scripts.
// Do NOT reintroduce a path under /home/eh/areas/secreg (the live course repo): it is the
// user's working material, he edits it at will, and a fixture derived from it goes red on an
// edit that regressed nothing. This comment is the only occurrence of that path permitted
// under scripts/ or fixtures/. See ../HERMETIC-TESTS.md.
import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHECK = path.join(import.meta.dir, "check.sh");
const CHECK_ADDENDUM = path.join(import.meta.dir, "check-addendum.py");
const FIXTURES = path.join(import.meta.dir, "..", "fixtures");
const SRC_TYP = path.join(FIXTURES, "source-addendum.typ");
const SRC_DOCS = path.join(FIXTURES, "docs");

const DOC_FILES = [
  "SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt",
  "SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt",
];

let ROOT = "";
let sections: string[] = [];

/**
 * The plan leg fails closed, and on a --no-plan run so does the length check, so every
 * invocation must say something about the interview and — when there is no plan — something
 * about length. A run WITH --plan takes its targets from the plan, so no target flag is added
 * there; each flag is added only when the caller named neither flag of that pair.
 */
function run(args: string[]) {
  const decided = args.includes("--plan") || args.includes("--no-plan");
  const targeted = args.includes("--target") || args.includes("--no-target");
  const needsTarget = !targeted && !args.includes("--plan");
  const extra = [...(decided ? [] : ["--no-plan"]), ...(needsTarget ? ["--no-target"] : [])];
  const r = spawnSync("bash", [CHECK, ...args, ...extra], {
    encoding: "utf8",
    timeout: 300_000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Verbatim argv, so the fail-closed default itself can be tested. */
function runRaw(args: string[], env?: Record<string, string>) {
  // MERGE, never replace: a bare env dict loses PATH, and check.sh needs `typst`
  // on it — the compile leg would then fail for the wrong reason and the leg under
  // test would never be reached.
  const r = spawnSync("bash", [CHECK, ...args], {
    encoding: "utf8",
    timeout: 300_000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * The stray-line sub-checks that RAN, by name. These tests ask which classes were
 * measured, not how they came out — so the set is what they assert. A pattern like
 * /SUB runt: (PASS|FAIL)/ would answer the same question while also passing on a
 * failure it did not mean to allow, which is what the suite linter flags.
 */
function subChecks(out: string): string[] {
  return [...out.matchAll(/^\s*SUB ([a-z-]+):/gm)].map(m => m[1]);
}

/** Lines announcing a leg's verdict, e.g. "LEG compile: PASS — ...". */
function legs(out: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^LEG (\w+): (PASS|FAIL)/);
    if (m) found[m[1]] = m[2];
  }
  return found;
}

/** A summary table whose page cells are the truth the compiled PDF reports. */
function calibrate(typPath: string) {
  const pdf = typPath.replace(/\.typ$/, ".pdf");
  spawnSync("typst", ["compile", "--root", path.dirname(path.dirname(typPath)), typPath, pdf], {
    encoding: "utf8",
  });
  const r = spawnSync("python3", [CHECK_ADDENDUM, typPath, pdf], { encoding: "utf8" });
  const truth = [...`${r.stdout ?? ""}`.matchAll(/^\s*\[pp\. (\d+)--(\d+)\],$/gm)];
  let i = 0;
  const src = fs.readFileSync(typPath, "utf8");
  fs.writeFileSync(
    typPath,
    src.replace(/\[pp\. \d+--\d+\],/g, () => {
      const t = truth[i++];
      return t ? `[pp. ${t[1]}--${t[2]}],` : "[pp. 1--1],";
    }),
  );
  fs.rmSync(pdf, { force: true });
}

/**
 * Build an addendum fixture from the real one: `keep` selects which reading
 * sections survive, `extra` is appended verbatim after them.
 */
function fixture(name: string, keep: number[], extra = "", opts: { calibrate?: boolean } = {}) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(path.join(dir, "addenda"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  for (const f of DOC_FILES) fs.copyFileSync(path.join(SRC_DOCS, f), path.join(dir, "docs", f));

  // The table's rows must stay in step with the kept readings, or the arity leg
  // is answering a question this fixture is not asking.
  const rowRe = /\s*\[7\],\n\s*\[[^\n]*\],\n\s*\[pp\. \d+--\d+\],\n/g;
  const allRows = sections[0].match(rowRe) ?? [];
  expect(allRows.length).toBe(4);
  const preamble = sections[0]
    .replace(/table\.header\(\n(.*?)\n\s*\),\n/s, (m) => `${m}@@ROWS@@\n`)
    .replace(rowRe, "")
    .replace("@@ROWS@@", keep.map((k) => allRows[k - 1]).join(""));

  const typ = [preamble, ...keep.map((k) => sections[k])].join("#pagebreak()\n") + extra;
  const typPath = path.join(dir, "addenda", `${name}.typ`);
  fs.writeFileSync(typPath, typ);
  if (opts.calibrate !== false) calibrate(typPath);
  return typPath;
}

/** A '## Doctrinal target' section carrying both interview answers. */
const GOOD_TARGET = `## Doctrinal target

- Doctrinal thread: pre-purchase managerial efforts count under Howey
- Cuts against: SEC v. Life Partners, assigned for the same class
- Taught for: reasoning

`;

/** Captions of the fixture readings, by their index in `sections`. */
const CAP = {
  lifePartners: "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.",
  mutualBenefits: "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.",
} as const;

/**
 * A '## Readings In Scope' table — the plan's per-reading page targets, which is where the
 * length check now gets its numbers.
 */
function scopeSection(rows: [caption: string, target: string][]) {
  return (
    "## Readings In Scope\n\n| caption | source | page target |\n|---|---|---|\n" +
    rows.map(([c, t]) => `| ${c} | docs/${c.slice(0, 8)}.txt | ${t} |\n`).join("") +
    "\n"
  );
}

function writePlan(name: string, body: string) {
  const p = path.join(ROOT, name, "plan.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

/** A caption block in the addendum's own shape, so check.sh derives it like any other. */
function readingBlock(title: string, body: string) {
  return `#pagebreak()\n\n#align(center)[\n  #text(13pt, weight: "bold")[${title}]\n\n  #v(0.4em)\n  Placeholder Court \\\n]\n\n#v(1em)\n\n${body}\n`;
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "elide-check-"));
  const src = fs.readFileSync(SRC_TYP, "utf8");
  sections = src.split("#pagebreak()\n");
  expect(sections.length).toBe(5); // preamble + four readings
});

describe("check.sh", () => {
  test("a good addendum passes every leg and exits 0", () => {
    const typ = fixture("good", [2, 3]); // Life Partners + Mutual Benefits
    const { code, out } = run(["--addendum", typ, "--target", "1-12"]);
    expect(legs(out)).toEqual({
      compile: "PASS",
      quotes: "PASS",
      addendum: "PASS",
      strays: "PASS",
    });
    expect(out).toContain("reading 2/2");
    expect(code).toBe(0);
  }, 300_000);

  test("every leg still runs when an earlier leg fails", () => {
    const typ = fixture("broken-compile", [2, 3]);
    fs.appendFileSync(typ, "\n#this-is-not-typst(\n");
    // A plan whose interview answers are absent, so the FIRST leg fails too.
    const plan = writePlan("broken-compile", "## Doctrinal target\n\n- Taught for: vibes\n");
    const { code, out } = run(["--addendum", typ, "--target", "1-12", "--plan", plan]);
    const seen = legs(out);
    // A line for each leg is what makes "no short-circuit" observable.
    expect(Object.keys(seen).sort()).toEqual([
      "addendum",
      "compile",
      "plan",
      "quotes",
      "strays",
    ]);
    expect(seen.plan).toBe("FAIL");
    expect(seen.compile).toBe("FAIL");
    expect(seen.quotes).toBe("PASS"); // ran to completion despite the failed compile
    expect(code).not.toBe(0);
  }, 300_000);

  test("the caption list is derived from the .typ, not passed in", () => {
    const extra =
      readingBlock(
        "SECURITIES AND EXCHANGE COMMISSION v. TERRAFORM LABS PTE LTD.",
        "Placeholder body.",
      ) +
      readingBlock("SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC. (REPRISE)", "Body.") +
      readingBlock("SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP. (REPRISE)", "Body.");
    const typ = fixture("five", [2, 3], extra, { calibrate: false });
    const { out } = run(["--addendum", typ]);
    for (let i = 1; i <= 5; i++) expect(out).toContain(`reading ${i}/5`);
  }, 300_000);

  test("a mutated table page range fails and names the addendum leg", () => {
    const typ = fixture("mutated", [2, 3]);
    const src = fs.readFileSync(typ, "utf8");
    const m = src.match(/\[pp\. (\d+)--(\d+)\],/);
    expect(m).not.toBeNull();
    fs.writeFileSync(typ, src.replace(m![0], `[pp. ${Number(m![1]) + 7}--${Number(m![2]) + 7}],`));
    const { code, out } = run(["--addendum", typ, "--target", "1-12"]);
    expect(legs(out).addendum).toBe("FAIL");
    expect(out).toContain("LEG addendum: FAIL");
    expect(code).not.toBe(0);
  }, 300_000);

  test("a reading with no resolvable source fails and names that reading", () => {
    const typ = fixture(
      "unsourced",
      [2, 3],
      readingBlock("IN RE ZZZQQQ WIDGETS LITIGATION", "Placeholder body."),
      { calibrate: false },
    );
    const { code, out } = run(["--addendum", typ]);
    expect(legs(out).quotes).toBe("FAIL");
    expect(out).toContain("IN RE ZZZQQQ WIDGETS LITIGATION");
    expect(out).not.toContain("reading 3/3\": PASS");
    expect(code).not.toBe(0);
  }, 300_000);

  test("two captions resolving to one source still get checked, and the sharing fails", () => {
    const typ = fixture(
      "shared",
      [2, 3],
      readingBlock("SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP. (REPRISE)", "Body."),
      { calibrate: false },
    );
    const { code, out } = run(["--addendum", typ]);
    // The sharing is its own failure, naming both readings and the shared file...
    expect(out).toMatch(/AMBIGUOUS MAPPING: readings [\d,]+ all resolve to SEC-v-Mutual-Benefits/);
    // ...but the quote check still RAN for the duplicate, rather than being
    // replaced by an unrun status. That substitution is the vacuous pass.
    expect(out).toMatch(/reading 3\/3 "[^"]*": (PASS|FAIL) \[derived\]/);
    expect(legs(out).quotes).toBe("FAIL");
    expect(code).not.toBe(0);
  }, 300_000);

  test("a declared source overrides the heuristic and is reported as declared", () => {
    const typ = fixture("declared", [3], "", { calibrate: false });
    const src = fs.readFileSync(typ, "utf8");
    fs.writeFileSync(
      typ,
      src.replace(
        "#align(center)[\n  #text(13pt",
        "// elide-source: SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt\n#align(center)[\n  #text(13pt",
      ),
    );
    const { out } = run(["--addendum", typ]);
    expect(out).toMatch(/reading 1\/1 "[^"]*": PASS \[declared\]/);
  }, 300_000);

  // An editors' note is authored commentary, never a quotation. Graded against the reporter
  // it always reports as missing, so ANY addendum carrying one failed the quotes leg by
  // construction until check.sh started passing --skip-editorial.
  test("an editors'-note block is not graded as court text", () => {
    const typ = fixture("editorial", [3], "", { calibrate: false });
    // Lands inside the LAST reading's body, which otherwise passes verbatim.
    fs.appendFileSync(
      typ,
      "\n#text(10pt)[\n*[Editors' note --- the efforts-of-others prong]*\n\n" +
        "This paragraph is the editor's own commentary and appears nowhere in the reporter, " +
        "which is precisely why grading it against the opinion is a category error.\n\n" +
        "Nor does this second editorial sentence appear in any court opinion ever published " +
        "in the Federal Reporter, and it must not be counted as a missing quotation.\n]\n",
    );
    const { out } = run(["--addendum", typ]);
    expect(out).not.toContain("This paragraph is the editor's own commentary");
    expect(out).toMatch(/reading 1\/1 "[^"]*": PASS \[derived\]/);
    expect(legs(out).quotes).toBe("PASS");
  }, 300_000);

  // The marker names a file that must EXIST, which is what stops it fabricating a pass:
  // otherwise `// elide-source:` would be a self-exemption wearing a different hat.
  test("an elide-source naming a missing file FAILS and names the file", () => {
    const typ = fixture("declared-missing", [3], "", { calibrate: false });
    const src = fs.readFileSync(typ, "utf8");
    fs.writeFileSync(
      typ,
      src.replace(
        "#align(center)[\n  #text(13pt",
        "// elide-source: NO-SUCH-SOURCE.txt\n#align(center)[\n  #text(13pt",
      ),
    );
    const { code, out } = run(["--addendum", typ]);
    expect(out).toContain("DECLARED-MISSING:NO-SUCH-SOURCE.txt");
    expect(out).toMatch(/reading 1\/1 "[^"]*": FAIL \[declared\]/);
    expect(legs(out).quotes).toBe("FAIL");
    expect(code).not.toBe(0);
  }, 300_000);

  test("a reading the PLAN declares non-court prints DECLARED-UNCHECKED and does not fail", () => {
    const typ = fixture(
      "plan-unchecked",
      [3],
      readingBlock("EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES", "Commentary body."),
      { calibrate: false },
    );
    const plan = writePlan("plan-unchecked", `${GOOD_TARGET}
## Non-court readings

- EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES — blog post, no reporter text

${scopeSection([
  [CAP.mutualBenefits, "2-6"],
  ["EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES", "1-2"],
])}`);
    const { out } = run(["--addendum", typ, "--plan", plan]);
    expect(out).toMatch(/reading 2\/2 "[^"]*": DECLARED-UNCHECKED \[plan\]/);
    expect(out).toContain("blog post, no reporter text");
    expect(legs(out).quotes).toBe("PASS");
    expect(legs(out).plan).toBe("PASS");
  }, 300_000);

  test("an in-.typ elide-unchecked marker is self-exempting and FAILS, naming the reading", () => {
    // The authority to call a reading non-court text belongs to the instructor. A marker
    // in the .typ lets the agent that wrote the excerpt switch the check off its own work.
    const typ = fixture(
      "self-exempt",
      [3],
      `// elide-unchecked: blog post, no reporter text\n${readingBlock(
        "EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES",
        "Commentary body.",
      )}`,
      { calibrate: false },
    );
    const { code, out } = run(["--addendum", typ]);
    expect(out).toContain("SELF-EXEMPTING");
    expect(out).toContain("EDWIN HU, SEC V. RIPPLE");
    expect(legs(out).quotes).toBe("FAIL");
    expect(code).not.toBe(0);

    // And declaring it properly in the plan does NOT rescue the marker.
    const plan = writePlan("self-exempt", `${GOOD_TARGET}
## Non-court readings

- EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES — blog post
`);
    const second = run(["--addendum", typ, "--plan", plan]);
    expect(legs(second.out).quotes).toBe("FAIL");
    expect(second.code).not.toBe(0);
  }, 300_000);

  test("an addendum where every reading is plan-declared unchecked verifies nothing and fails", () => {
    // The floor: a leg that ran no check has no verdict to report, so "PASS" would
    // certify nothing at all.
    const typ = fixture(
      "all-unchecked",
      [],
      readingBlock("EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES", "Commentary body.") +
        readingBlock("NOTE ON INVESTMENT CONTRACTS", "Commentary body."),
      { calibrate: false },
    );
    const plan = writePlan("all-unchecked", `${GOOD_TARGET}
## Non-court readings

- EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES — blog post
- NOTE ON INVESTMENT CONTRACTS — instructor commentary
`);
    const { code, out } = run(["--addendum", typ, "--plan", plan]);
    expect(out).toContain("NOTHING VERIFIED: 0 of 2 reading(s)");
    expect(out).toContain("2 declared unchecked");
    expect(legs(out).quotes).toBe("FAIL");
    expect(code).not.toBe(0);
  }, 300_000);

  describe("the --plan leg enforces the interview", () => {
    // Fail closed: an optional leg whose absence passes is an interview enforced by nothing.
    test("naming neither --plan nor --no-plan FAILS and names the missing flag", () => {
      const typ = fixture("plan-absent", [3], "", { calibrate: false });
      const { code, out } = runRaw(["--addendum", typ]);
      expect(legs(out).plan).toBe("FAIL");
      expect(out).toContain("--no-plan");
      expect(code).not.toBe(0);
    }, 300_000);

    test("--no-plan waives the leg loudly and does not fail", () => {
      // An otherwise-clean addendum, so a non-zero exit could only come from the plan leg.
      const typ = fixture("noplan", [3], "");
      const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
      expect(out).toContain("LEG plan: NOT CHECKED");
      expect(out).toContain("NOBODY IS CHECKING THE INTERVIEW ANSWERS");
      expect(legs(out).plan).toBeUndefined(); // neither PASS nor FAIL
      expect(code).toBe(0);
    }, 300_000);

    test("--plan and --no-plan together are contradictory and FAIL", () => {
      const typ = fixture("plan-both", [3], "", { calibrate: false });
      const plan = writePlan("plan-both", GOOD_TARGET);
      const { code, out } = runRaw(["--addendum", typ, "--plan", plan, "--no-plan", "--no-target"]);
      expect(legs(out).plan).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);

    test("a plan carrying both answers passes the leg", () => {
      const typ = fixture("plan-good", [3], "", { calibrate: false });
      const plan = writePlan(
        "plan-good",
        GOOD_TARGET + scopeSection([[CAP.mutualBenefits, "1-12"]]),
      );
      const { out } = run(["--addendum", typ, "--plan", plan]);
      expect(legs(out).plan).toBe("PASS");
    }, 300_000);

    test("a plan with no '## Doctrinal target' section fails", () => {
      const typ = fixture("plan-none", [3], "", { calibrate: false });
      const plan = writePlan("plan-none", "## Something else\n\nNothing here.\n");
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(legs(out).plan).toBe("FAIL");
      expect(out).toContain("## Doctrinal target");
      expect(code).not.toBe(0);
    }, 300_000);

    // Each missing answer must be named, so the agent is told which one to go ask for.
    const missing: [string, string, string][] = [
      [
        "the doctrinal thread",
        "- Doctrinal thread:\n- Cuts against: Life Partners\n- Taught for: reasoning\n",
        "'Doctrinal thread:'",
      ],
      [
        "what it cuts against",
        "- Doctrinal thread: pre-purchase managerial efforts\n- Cuts against: TBD\n- Taught for: reasoning\n",
        "'Cuts against:'",
      ],
      [
        "holding vs reasoning",
        "- Doctrinal thread: pre-purchase managerial efforts\n- Cuts against: Life Partners\n- Taught for:\n",
        "'Taught for:'",
      ],
      [
        "a Taught-for that is neither",
        "- Doctrinal thread: pre-purchase managerial efforts\n- Cuts against: Life Partners\n- Taught for: vibes\n",
        "neither holding nor reasoning",
      ],
    ];
    for (const [label, body, names] of missing) {
      test(`a plan missing ${label} fails and says so`, () => {
        const name = `plan-miss-${label.replace(/\W+/g, "-")}`;
        const typ = fixture(name, [3], "", { calibrate: false });
        const plan = writePlan(name, `## Doctrinal target\n\n${body}`);
        const { code, out } = run(["--addendum", typ, "--plan", plan]);
        expect(legs(out).plan).toBe("FAIL");
        expect(out).toContain(names);
        expect(code).not.toBe(0);
      }, 300_000);
    }
  });

  // A '## Non-court readings' bullet switches the FIRST Iron Law off the reading it hits, so
  // it must name that reading DEFINITELY. Matching on raw substrings would let a short or
  // generic bullet exempt readings the instructor never named.
  describe("a non-court bullet must name exactly one reading", () => {
    /** Two commentary captions sharing the word BLOG, plus one real court reading. */
    function blogFixture(name: string) {
      return fixture(
        name,
        [3],
        readingBlock("MARKET COMMENTARY BLOG ON RIPPLE", "Commentary body.") +
          readingBlock("PRACTITIONER BLOG ON TERRAFORM", "Commentary body."),
        { calibrate: false },
      );
    }

    function planWith(name: string, bullets: string) {
      return writePlan(
        name,
        `${GOOD_TARGET}\n## Non-court readings\n\n${bullets}\n${scopeSection([
          [CAP.mutualBenefits, "1-12"],
          ["MARKET COMMENTARY BLOG ON RIPPLE", "1-2"],
          ["PRACTITIONER BLOG ON TERRAFORM", "1-2"],
        ])}`,
      );
    }

    test("an exact caption exempts that reading and only that reading", () => {
      const typ = blogFixture("bullet-exact");
      const plan = planWith(
        "bullet-exact",
        "- MARKET COMMENTARY BLOG ON RIPPLE — blog post\n- PRACTITIONER BLOG ON TERRAFORM — blog post\n",
      );
      const { out } = run(["--addendum", typ, "--plan", plan]);
      expect(out).toMatch(/reading 2\/3 "[^"]*": DECLARED-UNCHECKED \[plan\]/);
      expect(out).toMatch(/reading 3\/3 "[^"]*": DECLARED-UNCHECKED \[plan\]/);
      expect(out).toMatch(/reading 1\/3 "[^"]*": PASS \[derived\]/);
      expect(legs(out).quotes).toBe("PASS");
      expect(legs(out).plan).toBe("PASS");
    }, 300_000);

    test("a generic bullet matching several captions exempts none and FAILS naming them", () => {
      const typ = blogFixture("bullet-generic");
      const plan = planWith("bullet-generic", "- blog — not court text\n");
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(out).toContain('PLAN BULLET IS AMBIGUOUS: "blog"');
      expect(out).toContain("MARKET COMMENTARY BLOG ON RIPPLE");
      expect(out).toContain("PRACTITIONER BLOG ON TERRAFORM");
      // Exempting neither is the point: both readings were still put to the check.
      expect(out).not.toContain("DECLARED-UNCHECKED");
      expect(legs(out).quotes).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);

    test("a bullet matching no caption FAILS naming the bullet", () => {
      const typ = blogFixture("bullet-none");
      const plan = planWith("bullet-none", "- IN RE ZZZQQQ WIDGETS — instructor commentary\n");
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(out).toContain('PLAN BULLET MATCHES NO READING: "IN RE ZZZQQQ WIDGETS"');
      expect(legs(out).quotes).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);

    test("a bullet matching only inside a word is no match, and does not exempt", () => {
      // "log" is a substring of "BLOG" but not one of its words. Under the old raw-substring
      // test it exempted both blog readings; a token-boundary match names nothing.
      const typ = blogFixture("bullet-subtoken");
      const plan = planWith("bullet-subtoken", "- log — not court text\n");
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(out).toContain('PLAN BULLET MATCHES NO READING: "log"');
      expect(out).not.toContain("DECLARED-UNCHECKED");
      expect(legs(out).quotes).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);
  });

  // Same rule as the plan leg, applied to length: an optional flag whose absence passes is a
  // check enforced by nothing, and a summary line claiming it holds is worse than the skip.
  describe("the length check fails closed", () => {
    test("naming neither --target nor --no-target FAILS and names the missing flag", () => {
      const typ = fixture("target-absent", [3]);
      const { code, out } = runRaw(["--addendum", typ, "--no-plan"]);
      expect(legs(out).addendum).toBe("FAIL");
      expect(out).toContain("--target");
      expect(out).toContain("--no-target");
      expect(out).not.toContain("and length all hold");
      expect(code).not.toBe(0);
    }, 300_000);

    test("--no-target waives the length check loudly and does not claim it holds", () => {
      // An otherwise-clean addendum, so a non-zero exit could only come from this decision.
      const typ = fixture("target-waived", [3]);
      const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
      expect(out).toContain("LENGTH NOT CHECKED");
      expect(out).toContain("NOBODY IS CHECKING PER-READING LENGTH");
      expect(legs(out).addendum).toBe("PASS");
      // The PASS line must state what was checked, not assert an unrun check.
      expect(out).not.toContain("and length all hold");
      expect(out).toContain("per-reading length NOT CHECKED");
      expect(code).toBe(0);
    }, 300_000);

    test("--target 2-6 on a too-long reading FAILS naming the reading and its page count", () => {
      const filler = Array.from(
        { length: 60 },
        (_, i) =>
          `Filler paragraph ${i} exists only to push this reading past the six-page target, ` +
          "and it is repeated enough times to make the excerpt run long.",
      ).join("\n\n");
      const typ = fixture("target-toolong", [3], `\n${filler}\n`, { calibrate: false });
      const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--target", "2-6"]);
      expect(out).toMatch(/FAIL length: reading 1 \([^)]*\) is \d+ page\(s\) at pp\. \d+--\d+; target is 2-6/);
      expect(legs(out).addendum).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);
  });

  // The page target used to be typed at the command line, which meant an agent could invent
  // one to suit its own output. It now comes from the plan the instructor approved, per
  // reading, and the plan leg enforces that the column is filled.
  describe("the page target comes from the plan", () => {
    test("a Readings In Scope row with no page target FAILS the plan leg, naming the row", () => {
      const typ = fixture("scope-notarget", [3], "", { calibrate: false });
      const plan = writePlan(
        "scope-notarget",
        GOOD_TARGET +
          "## Readings In Scope\n\n| caption | source | page target |\n|---|---|---|\n" +
          `| ${CAP.mutualBenefits} | docs/mb.txt | |\n`,
      );
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(legs(out).plan).toBe("FAIL");
      expect(out).toContain("MUTUAL BENEFITS CORP.");
      expect(out).toContain("has no page target");
      expect(code).not.toBe(0);
    }, 300_000);

    test("a placeholder page target FAILS the plan leg", () => {
      const typ = fixture("scope-tbd", [3], "", { calibrate: false });
      const plan = writePlan("scope-tbd", GOOD_TARGET + scopeSection([[CAP.mutualBenefits, "TBD"]]));
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(legs(out).plan).toBe("FAIL");
      expect(out).toContain("has no page target");
      expect(code).not.toBe(0);
    }, 300_000);

    test("a missing '## Readings In Scope' section FAILS the plan leg", () => {
      const typ = fixture("scope-absent", [3], "", { calibrate: false });
      const plan = writePlan("scope-absent", GOOD_TARGET);
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(legs(out).plan).toBe("FAIL");
      expect(out).toContain("## Readings In Scope");
      expect(code).not.toBe(0);
    }, 300_000);

    // The test that proves PER-READING rather than global. Life Partners runs 2 pages and
    // Mutual Benefits 4, so targets of 2-2 and 6-8 pass the first and fail the second. No
    // single global range produces that pair: any range containing 2 cannot report "target
    // is 6-8", and 6-8 itself would have flagged the 2-page reading too.
    test("each reading is measured against ITS OWN row's target", () => {
      const typ = fixture("per-reading", [2, 3]);
      const plan = writePlan(
        "per-reading",
        GOOD_TARGET +
          scopeSection([
            [CAP.lifePartners, "2-2"],
            [CAP.mutualBenefits, "6-8"],
          ]),
      );
      const { code, out } = run(["--addendum", typ, "--plan", plan]);
      expect(out).toMatch(/FAIL length: reading 2 \([^)]*MUTUAL BENEF[^)]*\) is 4 page\(s\).*target is 6-8/);
      expect(out).not.toMatch(/FAIL length: reading 1/);
      expect(legs(out).addendum).toBe("FAIL");
      expect(code).not.toBe(0);

      // Same addendum, same command line: widen only the SECOND row and the leg passes.
      const plan2 = writePlan(
        "per-reading",
        GOOD_TARGET +
          scopeSection([
            [CAP.lifePartners, "2-2"],
            [CAP.mutualBenefits, "3-5"],
          ]),
      );
      const second = run(["--addendum", typ, "--plan", plan2]);
      expect(second.out).toContain("is within");
      expect(legs(second.out).addendum).toBe("PASS");
      expect(second.code).toBe(0);
    }, 300_000);

    test("with a plan, an explicit --target is IGNORED and the plan's value is used", () => {
      const typ = fixture("target-ignored", [2, 3]);
      const plan = writePlan(
        "target-ignored",
        GOOD_TARGET +
          scopeSection([
            [CAP.lifePartners, "2-2"],
            [CAP.mutualBenefits, "3-5"],
          ]),
      );
      // 1-1 would fail both readings if the flag won.
      const { code, out } = runRaw(["--addendum", typ, "--plan", plan, "--target", "1-1"]);
      expect(out).toContain("IGNORED FLAG — --target 1-1");
      expect(out).toContain("2-2  SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS");
      expect(out).toContain("3-5  SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS");
      expect(out).not.toContain("target is 1-1");
      expect(legs(out).addendum).toBe("PASS");
      expect(code).toBe(0);
    }, 300_000);

    // REGRESSION GUARD, not a fail-first test: --no-plan --target has always worked, and this
    // pins that the override survived the move. It would have passed before the change too.
    test("--no-plan --target still measures every reading against the flag", () => {
      const typ = fixture("noplan-target", [2, 3]);
      const pass = runRaw(["--addendum", typ, "--no-plan", "--target", "1-12"]);
      expect(legs(pass.out).addendum).toBe("PASS");
      expect(pass.out).toContain("PASS length: every reading is within 1-12 pages");
      expect(pass.code).toBe(0);

      const fail = runRaw(["--addendum", typ, "--no-plan", "--target", "1-3"]);
      expect(fail.out).toMatch(/FAIL length: reading 2 .*target is 1-3/);
      expect(legs(fail.out).addendum).toBe("FAIL");
      expect(fail.code).not.toBe(0);
    }, 300_000);
  });

  // check-quotes.py proves the WORDS match the reporter and proves nothing about how
  // Typst SET them. These pin the page-level leg: a PDF with a known orphan fails, a
  // clean one passes, and the leg is ON by default so its absence cannot read as a pass.
  //
  // The fixture PDFs are DRAWN, not compiled. Typst 0.15's own layout suppressed every
  // attempt to provoke a widow from prose (40-point spacer sweep, 35-point page-height
  // sweep, both all-clean), so a Typst-compiled fixture would assert nothing about the
  // checker. Drawing the lines makes the defect stated rather than hoped for.
  describe("the strays leg decides widows, orphans, stranded headings and runts", () => {
    const STRANDED = path.join(import.meta.dir, "check-stranded-headings.py");
    const MAKE = path.join(FIXTURES, "make-pagebreak-fixture.py");
    // The runt checker is CANONICAL, in the typst plugin, and is resolved the way check.sh
    // resolves it. This named `<plugin>/scripts/check-widows.py` — the pre-split script that did
    // widows, orphans and runts together, and that exists in no plugin since typst separated them
    // into widows.py / orphans.py / runts.py. The test failed for years-old naming, not for a
    // defect, and nothing ran it to say so: skills/*/scripts/ was in no gate.
    const CANON = (() => {
      const r = spawnSync("typst-constraints", ["--dir"], { encoding: "utf8" });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
      for (const c of [`${process.env.HOME}/.claude/skills/typst/constraints`,
                       `${process.env.HOME}/projects/typst/constraints`]) {
        if (existsSync(path.join(c, "runts.py"))) return c;
      }
      throw new Error("the typst plugin was not found — the canonical checkers cannot run, which is not the same as their passing");
    })();
    const RUNTS = path.join(CANON, "runts.py");

    /** Any canonical checker, run the way check.sh runs it. */
    function checkCanon(name: string, pdf: string) {
      const py = pymupdfPython() ?? "python3";
      const r = spawnSync(py, [path.join(CANON, name), pdf, "--prose"], {
        encoding: "utf8",
        timeout: 300_000,
      });
      return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    }

    /** An interpreter that can import pymupdf, resolved the way the checker resolves it. */
    function pymupdfPython(): string | null {
      const r = spawnSync("python3", [STRANDED, ROOT, "--which-python"], {
        encoding: "utf8",
        timeout: 300_000,
      });
      const exe = `${r.stdout ?? ""}`.trim();
      return r.status === 0 && exe ? exe : null;
    }

    function makePdf(kind: string): string | null {
      const py = pymupdfPython();
      if (!py) return null;
      const out = path.join(ROOT, `pagebreak-${kind}.pdf`);
      const r = spawnSync(py, [MAKE, kind, out], { encoding: "utf8", timeout: 300_000 });
      if (r.status !== 0) throw new Error(`fixture build failed: ${r.stderr}`);
      return out;
    }

    function checkPdf(pdf: string) {
      const r = spawnSync("python3", [STRANDED, pdf], {
        encoding: "utf8",
        timeout: 300_000,
      });
      return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    }

    /** The runt checker, which is a SEPARATE script with its own exit code. */
    function checkRunts(pdf: string) {
      const py = pymupdfPython() ?? "python3";
      const r = spawnSync(py, [RUNTS, pdf, "--prose"], { encoding: "utf8", timeout: 300_000 });
      return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    }

    // ---- the dedup fix. FAIL-FIRST: before it, detect_widows keyed on
    // (slide_num, text), and on a document with no slide numbers slide_num is
    // None on EVERY page, so the key degenerated to a document-global dedup on
    // line text. The second "process." — page 2 here, page 17 on a real
    // addendum — was silently swallowed, and the loss grows with length.
    test("a repeated one-word line on a LATER page is still reported", () => {
      const pdf = makePdf("runt-repeat");
      if (!pdf) {
        console.warn("SKIPPED: no interpreter with pymupdf; set ELIDE_PYTHON");
        return;
      }
      const { code, out } = checkRunts(pdf);
      expect(out).toContain('page 1: "process."');
      expect(out).toContain('page 2: "process."'); // the one the old key swallowed
      expect(out).toContain("Found 4 potential runt(s)");
      expect(code).not.toBe(0);
    }, 300_000);

    // The name is the point: widow, orphan and runt have different causes and
    // different fixes, and reporting all three as "widow" is what let this class
    // go unmeasured. FAIL-FIRST: the script had no runt vocabulary at all.
    test("a runt is reported as a RUNT, not as a widow", () => {
      const pdf = makePdf("runt-repeat");
      if (!pdf) return;
      const { out } = checkRunts(pdf);
      expect(out).toContain("runt(s)");
      expect(out).not.toContain("widow/orphan(s)");
    }, 300_000);

    // ---- ragged-right prose now gets an ANSWER, not a refusal. FAIL-FIRST: the
    // local detector rested on justified body text, so on ragged-right input it
    // REFUSED (exit 3) — and three of the four real addenda are ragged right, so
    // nobody judged widows or orphans on them. The canonical checkers take the
    // paragraph boundary from the vertical gap, which needs no such premise.
    test("ragged-right prose is judged, not refused", () => {
      const pdf = makePdf("ragged");
      if (!pdf) return;
      for (const name of ["widows.py", "orphans.py"]) {
        const { code, out } = checkCanon(name, pdf);
        expect([0, 1]).toContain(code); // a verdict, not a non-answer
        expect(out).not.toContain("REFUSED");
      }
      // ...and the local script renders no widow/orphan verdict at all any more.
      const { out } = checkPdf(pdf);
      expect(out).not.toContain("widow");
      expect(out).not.toContain("orphan");
    }, 300_000);

    // The stranded-heading check is bold-and-short, not flush-right, so it is
    // geometry-independent — which is why this class stayed local when widow and
    // orphan went canonical. On the real Tornetta addendum it was the one genuine
    // finding of the four the old checker reported.
    test("a heading stranded at the foot of ragged-right prose is still found", () => {
      const pdf = makePdf("ragged-heading");
      if (!pdf) return;
      const { code, out } = checkPdf(pdf);
      expect(out).toContain("stranded-heading at the foot of page 1");
      expect(code).toBe(1);
    }, 300_000);

    // The two detection classes are canonical, so this asserts they FIND the
    // defect the fixture states — not which script holds them.
    test("a PDF with a known orphan is caught by the canonical checker", () => {
      const pdf = makePdf("orphan");
      if (!pdf) {
        // Never a silent skip: say the check did not run.
        console.warn("SKIPPED: no interpreter with pymupdf; set ELIDE_PYTHON");
        return;
      }
      const { code, out } = checkCanon("orphans.py", pdf);
      expect(out).toContain("ORPHANED first line");
      expect(code).toBe(1);
    }, 300_000);

    test("a PDF with a known widow is caught by the canonical checker", () => {
      const pdf = makePdf("widow");
      if (!pdf) return;
      const { code, out } = checkCanon("widows.py", pdf);
      expect(out).toContain("WIDOWED last line.");
      expect(code).toBe(1);
    }, 300_000);

    test("a heading stranded at the foot of a page FAILS", () => {
      const pdf = makePdf("stranded-heading");
      if (!pdf) return;
      const { code, out } = checkPdf(pdf);
      expect(out).toContain("stranded-heading at the foot of page 1");
      expect(code).toBe(1);
    }, 300_000);

    test("a clean PDF passes, so the failures above are not the checker crying wolf", () => {
      const pdf = makePdf("clean");
      if (!pdf) return;
      const { code, out } = checkPdf(pdf);
      expect(out).toContain("PASS stranded-headings");
      expect(code).toBe(0);
      for (const name of ["widows.py", "orphans.py"]) {
        expect(checkCanon(name, pdf).code).toBe(0);
      }
    }, 300_000);

    // The fix vocabulary is layout-only, and the checker says so on every failure:
    // rewording the court's text to close a defect would defeat the verbatim gate.
    test("a failure states that the fix is layout, never the court's words", () => {
      const pdf = makePdf("stranded-heading");
      if (!pdf) return;
      const { out } = checkPdf(pdf);
      expect(out).toContain("FIX BY LAYOUT ONLY");
      expect(out).toContain("defeat the verbatim gate");
    }, 300_000);

    // FAIL-CLOSED. The leg's default is ON, so naming no widow flag RUNS it. This is
    // the assertion that an absent flag cannot be the quiet way to skip page breaks.
    test("naming no strays flag still runs the leg", () => {
      const typ = fixture("widows-default", [3], "", { calibrate: false });
      const { out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
      expect(legs(out).strays).toBe("PASS");
      expect(out).not.toContain("NOBODY IS CHECKING PAGE BREAKS OR RUNTS");
    }, 300_000);

    // FAIL-CLOSED, for the RUNT sub-check specifically. A new sub-check whose absence
    // passes is a defect class enforced by nothing. Naming no flag must RUN it, and
    // report it under its own name beside — not merged into — the widow/orphan verdict.
    test("naming no strays flag runs all four sub-checks under their own names", () => {
      const typ = fixture("runt-default", [3], "", { calibrate: false });
      const { out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
      // Four classes, four verdicts. One going unmeasured must never be absorbed
      // into another's: that is how the runt class stayed invisible while the leg
      // called a 20-runt document clean.
      expect(subChecks(out).sort()).toEqual(["orphan", "runt", "stranded-heading", "widow"]);
    }, 300_000);

    // FAIL-CLOSED on the canonical checkers themselves. They live in another plugin,
    // so "not installed" is a real state — and a leg that skipped them quietly would
    // report clean having measured nothing, which is the failure this whole split
    // exists to end.
    test("a canonical checker that cannot be found FAILS the leg, naming it", () => {
      const typ = fixture("canon-missing", [3]);
      // Shadow `typst-constraints` with a stub that refuses, rather than emptying
      // PATH — check.sh needs `typst` on it to reach this leg at all.
      const shadow = path.join(ROOT, "shadow-bin");
      fs.mkdirSync(shadow, { recursive: true });
      fs.writeFileSync(path.join(shadow, "typst-constraints"), "#!/bin/sh\nexit 1\n");
      fs.chmodSync(path.join(shadow, "typst-constraints"), 0o755);
      const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"], {
        TYPST_CHECKERS_DIR: path.join(ROOT, "no-such-constraints-dir"),
        PATH: `${shadow}:${process.env.PATH}`,
        HOME: path.join(ROOT, "no-such-home"),
      });
      expect(out).toContain("nothing checked widows");
      expect(out).toContain("nothing checked orphans");
      expect(out).toContain("nothing checked runts");
      expect(legs(out).strays).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);

    test("--no-strays waives the canonical sub-checks too, and says so", () => {
      const typ = fixture("runt-waived", [3]);
      const { out } = runRaw(["--addendum", typ, "--no-plan", "--no-target", "--no-strays"]);
      expect(out).toContain("NOBODY IS CHECKING PAGE BREAKS OR RUNTS");
      expect(out).not.toMatch(/^\s*SUB runt:/m);
    }, 300_000);

    // REGRESSION GUARD, not fail-first: the leg was renamed and its callers were not,
    // so the old flag name must keep working. --no-widows passed before this change too.
    test("--no-widows is still accepted as the old name of --no-strays", () => {
      const typ = fixture("strays-alias", [3]);
      const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--no-target", "--no-widows"]);
      expect(out).toContain("LEG strays: NOT CHECKED");
      expect(code).toBe(0);
    }, 300_000);

    /**
     * The same fixture set ragged right — Typst's own default, and how the real
     * addendum this work came from is set. `--pdf` cannot be used to inject a drawn
     * PDF here because the compile leg writes to that path, so the raggedness has to
     * come from the source.
     */
    function raggedFixture(name: string) {
      const typ = fixture(name, [3], "", { calibrate: false });
      const src = fs.readFileSync(typ, "utf8");
      expect(src).toContain("#set par(justify: true)");
      fs.writeFileSync(typ, src.replace("#set par(justify: true)", "#set par(justify: false)"));
      return typ;
    }

    // The end of the refusal, asserted through the leg rather than the script. The
    // real addenda are set ragged right — three of four — and under the old local
    // detector that meant nobody judged widows or orphans on them. Every class now
    // returns a verdict on exactly that input.
    test("a ragged-right addendum gets a verdict on every class, not a refusal", () => {
      const typ = raggedFixture("strays-ragged");
      const { out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
      expect(out).not.toContain("NOT JUDGED");
      expect(out).not.toContain("REFUSED");
      expect(subChecks(out).sort()).toEqual(["orphan", "runt", "stranded-heading", "widow"]);
    }, 300_000);

    test("--no-strays waives the leg loudly and never claims stray lines hold", () => {
      // Calibrated, so every other leg passes and the waiver reaches the PASS summary.
      const typ = fixture("widows-waived", [3]);
      const { out } = runRaw(["--addendum", typ, "--no-plan", "--no-target", "--no-strays"]);
      expect(out).toContain("LEG strays: NOT CHECKED");
      expect(out).toContain("NOBODY IS CHECKING PAGE BREAKS OR RUNTS");
      expect(legs(out).strays).toBeUndefined(); // neither PASS nor FAIL
      expect(out).toContain("stray lines, which --no-strays waived");
    }, 300_000);

    test("--strays and --no-strays together are contradictory and FAIL", () => {
      const typ = fixture("widows-both", [3], "", { calibrate: false });
      const { code, out } = runRaw([
        "--addendum", typ, "--no-plan", "--no-target", "--strays", "--no-strays",
      ]);
      expect(legs(out).strays).toBe("FAIL");
      expect(code).not.toBe(0);
    }, 300_000);

    // A compile failure must not let the widows leg report a stale or absent PDF as
    // clean — there is nothing to inspect, and that is a FAIL, not a pass.
    test("a failed compile FAILS the strays leg rather than passing it", () => {
      const typ = fixture("widows-nopdf", [3], "", { calibrate: false });
      fs.appendFileSync(typ, "\n#this-is-not-typst(\n");
      const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
      expect(legs(out).compile).toBe("FAIL");
      expect(legs(out).strays).toBe("FAIL");
      expect(out).toContain("no compiled PDF to inspect");
      expect(code).not.toBe(0);
    }, 300_000);
  });

  test("a gap-matched sentence surfaces its warning even when the reading PASSES", () => {
    const typ = fixture("gap", [3], "", { calibrate: false });
    const { out } = run(["--addendum", typ]);
    const raw = spawnSync(
      "python3",
      [path.join(import.meta.dir, "check-quotes.py"), typ, path.join(ROOT, "gap", "docs", DOC_FILES[1])],
      { encoding: "utf8" },
    );
    const rawOut = `${raw.stdout ?? ""}${raw.stderr ?? ""}`;
    // Only meaningful if the underlying checker actually reports a gap here AND passes.
    expect(raw.status).toBe(0);
    expect(rawOut).toContain("matched across a source gap");
    expect(legs(out).quotes).toBe("PASS");
    expect(out).toContain("matched across a source gap");
  }, 300_000);

  test("--docs points the resolver at an arbitrary directory", () => {
    const typ = fixture("docsflag", [3], "", { calibrate: false });
    const elsewhere = path.join(ROOT, "docsflag", "moved-docs");
    fs.renameSync(path.join(ROOT, "docsflag", "docs"), elsewhere);
    expect(legs(run(["--addendum", typ]).out).quotes).toBe("FAIL");
    expect(legs(run(["--addendum", typ, "--docs", elsewhere]).out).quotes).toBe("PASS");
  }, 300_000);

  // The run-level `elide-check` invokes this fixture with --no-plan, which the plan leg
  // requires: a fixture has no interview to record, and the leg fails closed rather than
  // letting an absent flag be the quiet way to skip it. These two tests pin both halves of
  // that invocation — the waived form passes, the flagless form is refused.
  test("the shipped fixture is self-contained and passes with --no-plan", () => {
    const fixtureTyp = path.join(import.meta.dir, "..", "fixtures", "mini-addendum.typ");
    expect(fs.existsSync(fixtureTyp)).toBe(true);
    const { code, out } = runRaw(["--addendum", fixtureTyp, "--target", "1-6", "--no-plan"]);
    expect(legs(out)).toEqual({
      compile: "PASS",
      quotes: "PASS",
      addendum: "PASS",
      strays: "PASS",
    });
    expect(code).toBe(0);
  }, 300_000);

  test("the same fixture invocation WITHOUT a plan flag is refused", () => {
    const fixtureTyp = path.join(import.meta.dir, "..", "fixtures", "mini-addendum.typ");
    const { code, out } = runRaw(["--addendum", fixtureTyp, "--target", "1-6"]);
    expect(legs(out).plan).toBe("FAIL");
    expect(code).not.toBe(0);
  }, 300_000);
});
