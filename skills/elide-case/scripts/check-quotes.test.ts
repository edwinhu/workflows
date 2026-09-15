// Specification for scripts/check-quotes.py — the quotation-fidelity gate.
//
// Two holes this pins shut, both found by running the checker for real:
//   (a) it returned 0 having checked ZERO sentences — a vacuous pass;
//   (b) its footnote-marker stripper ate legal pincites ("560 n.11"), manufacturing
//       misses on correct excerpts.
// Fixtures are written into a temp dir; nothing outside it is touched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dir, "check-quotes.py");
let ROOT = "";

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "check-quotes-"));
});
afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

function reading(title: string, body: string) {
  return `#align(center)[\n  #text(13pt, weight: "bold")[${title}]\n\n  #v(0.4em)\n  Placeholder Court \\\n]\n\n#v(1em)\n\n${body}\n`;
}

/** Write a .typ/.txt pair and run the checker over it. */
function run(name: string, typ: string, source: string, args: string[] = []) {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const typPath = path.join(dir, "a.typ");
  const srcPath = path.join(dir, "a.txt");
  fs.writeFileSync(typPath, typ);
  fs.writeFileSync(srcPath, source);
  const r = spawnSync("python3", [SCRIPT, typPath, srcPath, ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Call strip_furniture() directly, so the marker regex is pinned, not inferred. */
function stripFurniture(text: string): string {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cq", ${JSON.stringify(SCRIPT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.stdout.write(m.strip_furniture(json.loads(sys.stdin.read())))
`;
  const r = spawnSync("python3", ["-c", driver], {
    input: JSON.stringify(text),
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

/** Call strip_typ_markup() directly, so the Typst-markup rules are pinned, not inferred. */
function stripTyp(body: string): string {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cq", ${JSON.stringify(SCRIPT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.stdout.write(m.strip_typ_markup(json.loads(sys.stdin.read())))
`;
  const r = spawnSync("python3", ["-c", driver], {
    input: JSON.stringify(body),
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

describe("check-quotes.py", () => {
  test("a reading yielding zero long sentences FAILS instead of passing vacuously", () => {
    const title = "IN RE SHORT SENTENCES";
    const { code, out } = run(
      "vacuous",
      reading(title, "Short. Too brief. No quote."),
      "Short. Too brief. No quote. Nothing here is long enough to check either.\n",
    );
    expect(out).toContain("0 sentences checked");
    expect(out).toContain(title);
    expect(out).toMatch(/FAIL nothing checked/);
    expect(code).not.toBe(0);
  });

  test("a reading that does check sentences still passes", () => {
    const sentence =
      "The economic reality of the transaction controls, and the label the parties " +
      "attach to it does not.";
    const { code, out } = run("sane", reading("IN RE REAL PROSE", sentence), `${sentence}\n`);
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(out).not.toContain("FAIL nothing checked");
    expect(code).toBe(0);
  });

  test("the footnote-marker stripper eats markers but never a pincite", () => {
    // Markers welded to a comma are apparatus and must go.
    expect(stripFurniture("Smith et al.,1 wrote")).toBe("Smith et al., wrote");
    expect(stripFurniture("market speculation,5 not")).toBe("market speculation, not");
    // Digits after a PERIOD are reporter text and must survive verbatim.
    expect(stripFurniture("Weaver, 455 U.S. 551, 560 n.11 (1982)")).toBe(
      "Weaver, 455 U.S. 551, 560 n.11 (1982)",
    );
    expect(stripFurniture("560 n. 5 (1982)")).toBe("560 n. 5 (1982)");
    expect(stripFurniture("Marbury, 328 U.S. 293")).toBe("Marbury, 328 U.S. 293");
    expect(stripFurniture("87 F.3d at 552")).toBe("87 F.3d at 552");
    expect(stripFurniture("the Securities Acts of 1933 and 1934")).toBe(
      "the Securities Acts of 1933 and 1934",
    );
  });

  test("an excerpt carrying a footnote pincite is not reported as a miss", () => {
    const sentence =
      "The Court has long held that a private right of action exists under the statute, " +
      "see Weaver, 455 U.S. 551, 560 n.11 (1982), and nothing here disturbs that holding.";
    const { code, out } = run(
      "pincite",
      reading("IN RE PINCITES", sentence),
      `Some preceding text. ${sentence}\n`,
    );
    expect(out).not.toContain("MISS");
    expect(out).toContain(", 0 not found");
    expect(code).toBe(0);
  });

  // A Westlaw DOCX export interleaves star pagination mid-sentence. Left in place it
  // normalises to a bare number inside the sentence, so a verbatim excerpt reads as a miss.
  test("the furniture stripper eats Westlaw star pages but never an emphasis asterisk", () => {
    expect(stripFurniture("the vast *329 majority of individuals")).toBe(
      "the vast majority of individuals",
    );
    expect(stripFurniture("at *738 the court held")).toBe("at the court held");
    // An asterisk NOT welded to digits is emphasis or a footnote symbol; it survives.
    expect(stripFurniture("the * * * separator")).toBe("the * * * separator");
    expect(stripFurniture("see note * below")).toBe("see note * below");
    expect(stripFurniture("a *word* emphasised")).toBe("a *word* emphasised");
  });

  test("a sentence split by a star-page marker in the source is not reported as a miss", () => {
    const excerpt =
      "Therefore, the vast majority of individuals who purchased XRP did so with an " +
      "expectation of profit derived from the efforts of Ripple and its agents.";
    const source =
      "Therefore, the vast *329 majority of individuals who purchased XRP did so with an " +
      "expectation of profit derived from the efforts of Ripple and its agents.\n";
    const { code, out } = run("starpage", reading("SEC v. RIPPLE LABS, INC.", excerpt), source);
    expect(out).not.toContain("MISS");
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  // A case reported in two reporters carries TWO interleaved star series, and Westlaw
  // marks the parallel one with a DOUBLE asterisk ("*538 **304"). A single-asterisk-only
  // pattern leaves the extra "*" stranded mid-sentence, breaking verbatim matching for
  // exactly the federal appellate opinions that carry a parallel cite.
  test("the furniture stripper eats a parallel DOUBLE-asterisk star page", () => {
    expect(stripFurniture("airman *538 **304 Brian P. Peden")).toBe(
      "airman Brian P. Peden",
    );
    expect(stripFurniture("or was *540 **306 at all times")).toBe("or was at all times");
    expect(stripFurniture("the ** separator")).toBe("the ** separator");
  });

  test("a sentence split by BOTH star series in the source is not reported as a miss", () => {
    const excerpt =
      "The policies were purchased from a retired airman Brian P. Peden and from other " +
      "insureds who had no apparent expectation of recovery beyond the resale proceeds.";
    const source =
      "The policies were purchased from a retired airman *538 **304 Brian P. Peden and " +
      "from other insureds who had no apparent expectation of recovery beyond the " +
      "resale proceeds.\n";
    const { code, out } = run(
      "starpage-double",
      reading("SEC v. LIFE PARTNERS, INC.", excerpt),
      source,
    );
    expect(out).not.toContain("MISS");
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  // `// elide-source:` and `// elide-unchecked:` are machine directives that check.sh
  // parses out of the .typ. Before the fix they reached the sentence splitter and were
  // graded as quoted court text — and, sitting one line above the NEXT reading's caption,
  // were reported against the PRECEDING reading.
  test("elide- directive lines are not graded as court text", () => {
    const sentence =
      "The economic reality of the transaction controls, and the label the parties " +
      "attach to it does not.";
    const excerpt =
      "// elide-source: SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt\n" +
      `${sentence}\n` +
      "// elide-unchecked: reading 4 is declared unchecked in the plan\n";
    const { code, out } = run(
      "elide-directive",
      reading("SEC v. RIPPLE LABS, INC.", excerpt),
      `${sentence}\n`,
    );
    expect(out).not.toContain("MISS");
    expect(out).not.toContain("elide-source");
    expect(out).not.toContain("elide-unchecked");
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  // Narrowness assertion: only `// elide-` lines go. A `//` inside quoted court text —
  // a URL in a citation — must survive intact, or the stripper eats real court text.
  test("a sentence carrying an inline https:// URL survives the directive stripper", () => {
    const sentence =
      "The offering materials were posted at https://example.com/whitepaper and were " +
      "available to every purchaser before the closing date.";
    const { code, out } = run(
      "url-survives",
      reading("SEC v. URL CASE", sentence),
      `${sentence}\n`,
    );
    expect(out).not.toContain("MISS");
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  // `~` is Typst markup rendering as U+00A0 — the layout-only fix for a runt, which pulls
  // the penultimate word down without altering a character of the court's text. All three
  // of the following are REGRESSION GUARDS, not fail-first tests: norm() already folds `~`
  // and U+00A0 into a space on both sides, so they pass before and after the change. They
  // pin that behavior against a future normalizer that stops doing it.
  test("REGRESSION GUARD: a tilde in the .typ matches an ordinary space in the source", () => {
    const excerpt =
      "The inquiry is an objective one focusing on the promises and offers made to " +
      "investors; it is not a search for the precise motivation of each individual~participant.";
    const source =
      "The inquiry is an objective one focusing on the promises and offers made to " +
      "investors; it is not a search for the precise motivation of each individual participant.\n";
    const { code, out } = run("tilde-typ", reading("SEC v. RIPPLE LABS, INC.", excerpt), source);
    expect(out).not.toContain("MISS");
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  test("REGRESSION GUARD: a U+00A0 in the SOURCE matches an ordinary space in the .typ", () => {
    const excerpt =
      "The economic reality of the transaction controls, and the label the parties " +
      "attach to it does not.";
    // A Westlaw export can carry a literal U+00A0 where the reporter set a space.
    const NBSP = "\u00A0";
    const source = `${excerpt.replaceAll(" ", NBSP)}\n`;
    expect(source).toContain(NBSP);
    const { code, out } = run("nbsp-source", reading("IN RE NBSP SOURCE", excerpt), source);
    expect(out).not.toContain("MISS");
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  // Narrowness assertion: the tilde becomes exactly ONE space and eats nothing beside it.
  // Stripping `~` together with its neighbours, or treating it as a wildcard, WOULD be a
  // loosening — these two negative cases are what forbid that.
  test("REGRESSION GUARD: a tilde absorbs no adjacent character and is no wildcard", () => {
    expect(stripTyp("foo~bar")).toBe("foo bar");
    expect(stripTyp("foo~bar~baz")).toBe("foo bar baz");

    const excerpt =
      "The parties agreed that the consideration was paid in full before the closing " +
      "date and that no foo~bar remained outstanding.";
    // Matches the one-space reading.
    const ok = run(
      "tilde-exact",
      reading("IN RE TILDE WIDTH", excerpt),
      `${excerpt.replace("foo~bar", "foo bar")}\n`,
    );
    expect(ok.out).toContain("1 sentences checked, 0 not found");
    expect(ok.code).toBe(0);
    // Must NOT match a source that closed the space up ("foobar").
    const closed = run(
      "tilde-not-closed",
      reading("IN RE TILDE WIDTH", excerpt),
      `${excerpt.replace("foo~bar", "foobar")}\n`,
    );
    expect(closed.out).toContain("MISS");
    expect(closed.code).not.toBe(0);
    // Must NOT match a source carrying an extra word across the tilde ("foo bar baz").
    const extra = run(
      "tilde-not-wildcard",
      reading("IN RE TILDE WIDTH", excerpt),
      `${excerpt.replace("foo~bar", "foo bar baz")}\n`,
    );
    expect(extra.out).toContain("MISS");
    expect(extra.code).not.toBe(0);
  });

  test("the Telegram baseline alteration is still reported as a miss", () => {
    const source =
      "The representation and warranty that the Initial Purchasers purchased without a " +
      "view towards resale rings hollow. From Telegram's perspective, the offering was " +
      "a single scheme.\n";
    const altered = "That representation rings hollow: from Telegram's perspective.";
    const { code, out } = run("telegram", reading("SEC v. TELEGRAM GROUP INC.", altered), source);
    expect(out).toContain("MISS");
    expect(out).toContain("That representation rings hollow");
    expect(code).not.toBe(0);
  });
});

// The .docx is the source of record. These pin the three properties that makes true:
// a flat-OPC export is readable at all, its italics arrive as Typst emphasis, and a
// plain-text source says out loud that it carried none.
describe("a .docx source", () => {
  /** A minimal FLAT OPC package: document.xml at the zip ROOT, as Westlaw exports it. */
  function flatOpc(dir: string, paras: string[]): string {
    const xml =
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paras.join("")}` +
      `</w:body></w:document>`;
    const out = path.join(dir, "a.docx");
    const driver = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("document.xml", sys.stdin.read())
    z.writestr("footnotes.xml", "<a/>")
`;
    const r = spawnSync("python3", ["-c", driver, out], { input: xml, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return out;
  }

  const run_ = (t: string, ital = false) =>
    `<w:r>${ital ? "<w:rPr><w:i/></w:rPr>" : ""}<w:t>${t}</w:t></w:r>`;

  /** One sentence, its case name italic, exactly as the reporter sets it. */
  const PARA =
    "<w:p>" +
    run_("The entire fairness standard announced in ") +
    run_("Weinberger", true) +
    run_(" governs this transaction, and the parties agree that it does.") +
    "</w:p>";

  function runDocx(name: string, typ: string, args: string[] = []) {
    const dir = path.join(ROOT, name);
    fs.mkdirSync(dir, { recursive: true });
    const typPath = path.join(dir, "a.typ");
    fs.writeFileSync(typPath, typ);
    const r = spawnSync("python3", [SCRIPT, typPath, flatOpc(dir, [PARA]), ...args], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  const EXCERPT = reading(
    "TORNETTA v. MUSK",
    "The entire fairness standard announced in _Weinberger_ governs this transaction, " +
      "and the parties agree that it does.",
  );

  test("is projected in memory and verifies the excerpt", () => {
    const { code, out } = runDocx("docx-ok", EXCERPT);
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(out).toContain("projected in memory");
    expect(code).toBe(0);
  });

  test("carries the court's italics through as Typst emphasis", () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "proj-"));
    const driver = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("cq", ${JSON.stringify(SCRIPT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.stdout.write(m.load_source(__import__("pathlib").Path(sys.argv[1]))[0])
`;
    const r = spawnSync("python3", ["-c", driver, flatOpc(dir, [PARA])], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("_Weinberger_");
  });

  test("an excerpt set in ROMAN still matches, because norm() folds the marks away", () => {
    const { code, out } = runDocx(
      "docx-roman",
      reading(
        "TORNETTA v. MUSK",
        "The entire fairness standard announced in Weinberger governs this transaction, " +
          "and the parties agree that it does.",
      ),
    );
    expect(out).toContain("1 sentences checked, 0 not found");
    expect(code).toBe(0);
  });

  test("a .txt source says ITALICS NOT CHECKED rather than passing silently", () => {
    const { code, out } = run(
      "txt-lossy",
      reading("TORNETTA v. MUSK", "The entire fairness standard governs this transaction, and both parties agree."),
      "The entire fairness standard governs this transaction, and both parties agree.\n",
    );
    expect(out).toContain("ITALICS NOT CHECKED");
    expect(code).toBe(0);
  });
});
