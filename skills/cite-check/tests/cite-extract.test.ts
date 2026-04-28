import { describe, expect, it } from "bun:test";
import { extractCitations } from "../cite-extract";

describe("extractCitations", () => {
  it("extracts a single bracketed citation", () => {
    const md = "Hirst argues something important [@Hirst2022-pq].";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(1);
    expect(cites[0].bibkey).toBe("Hirst2022-pq");
    expect(cites[0].locator).toBeUndefined();
    expect(cites[0].file).toBe("/tmp/x.md");
    expect(cites[0].line).toBe(1);
    expect(cites[0].claim).toContain("Hirst argues something important");
  });

  it("captures locator from [@key, p. 42]", () => {
    const md = "See discussion [@Hirst2022-pq, p. 42] for details.";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(1);
    expect(cites[0].bibkey).toBe("Hirst2022-pq");
    expect(cites[0].locator).toBe("p. 42");
  });

  it("splits multi-cite [@a; @b, p. 5] into separate citations", () => {
    const md = "These works disagree [@Foo2020-aa; @Bar2021-bb, p. 5].";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(2);
    expect(cites[0].bibkey).toBe("Foo2020-aa");
    expect(cites[0].locator).toBeUndefined();
    expect(cites[1].bibkey).toBe("Bar2021-bb");
    expect(cites[1].locator).toBe("p. 5");
  });

  it("extracts in-text @key citations", () => {
    const md = "@Foo2020 says X is true.";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(1);
    expect(cites[0].bibkey).toBe("Foo2020");
    expect(cites[0].claim).toContain("says X is true");
  });

  it("captures the full sentence including the citation", () => {
    const md = "First sentence. Hirst argues X [@Hirst2022-pq]. Next sentence.";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(1);
    expect(cites[0].claim).toContain("Hirst argues X");
    expect(cites[0].claim).not.toContain("First sentence");
    expect(cites[0].claim).not.toContain("Next sentence");
  });

  it("returns empty for text with no citations", () => {
    expect(extractCitations("Just plain text here.", "/tmp/x.md")).toEqual([]);
  });

  it("supports bibkeys with hyphens, colons, digits", () => {
    const md = "See [@A2020-pq] and [@B:foo-bar123] together.";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(2);
    expect(cites[0].bibkey).toBe("A2020-pq");
    expect(cites[1].bibkey).toBe("B:foo-bar123");
  });

  it("does not match email-like @ tokens via in-text rule", () => {
    // `foo@bar.com` should not produce a citation. The lookbehind blocks
    // the @ after a word char; "foo" is the word char preceding @.
    const md = "Email me at foo@bar.com please.";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites).toEqual([]);
  });

  it("tracks line numbers correctly", () => {
    const md = "Line one.\nLine two.\nLine three has a cite [@Foo2020-aa].\n";
    const cites = extractCitations(md, "/tmp/x.md");
    expect(cites.length).toBe(1);
    expect(cites[0].line).toBe(3);
  });

  describe("footnote indirection", () => {
    it("resolves footnote-defined cite to the body sentence containing the marker", () => {
      const md = [
        "Some claim about ETFs holding 30% of US equities.[^2]",
        "",
        "[^2]: According to data [@source2024, p. 42].",
        "",
      ].join("\n");
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].bibkey).toBe("source2024");
      expect(cites[0].locator).toBe("p. 42");
      // Claim should be the body sentence, not the footnote definition line.
      expect(cites[0].claim).toContain("Some claim about ETFs");
      expect(cites[0].claim).not.toContain("[^2]:");
      // footnoteContext = the footnote body text.
      expect(cites[0].footnoteContext).toBeDefined();
      expect(cites[0].footnoteContext).toContain("According to data");
      // Line should still point to the footnote DEFINITION (line 3 here).
      expect(cites[0].line).toBe(3);
    });

    it("uses the FIRST body marker when footnote is referenced multiple times", () => {
      const md = [
        "First mention here.[^a]",
        "",
        "Second mention later.[^a]",
        "",
        "[^a]: Footnote body [@key2024].",
        "",
      ].join("\n");
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].claim).toContain("First mention here");
      expect(cites[0].claim).not.toContain("Second mention");
    });

    it("falls back to footnote body when there is no body marker (orphan footnote)", () => {
      const md = [
        "Body text with no marker.",
        "",
        "[^orphan]: This footnote is never referenced [@key2024].",
        "",
      ].join("\n");
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].bibkey).toBe("key2024");
      // Claim falls back to footnote body content.
      expect(cites[0].claim).toContain("This footnote is never referenced");
      // No body sentence found, so footnoteContext is undefined.
      expect(cites[0].footnoteContext).toBeUndefined();
    });

    it("regular (non-footnote) cite leaves footnoteContext undefined", () => {
      const md = "Regular cite [@Hirst2022-pq] in body.";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].footnoteContext).toBeUndefined();
    });
  });

  describe("bluebook signal detection", () => {
    it("detects 'See' immediately preceding a cite", () => {
      const md = "X is true. See [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see");
    });

    it("detects 'See, e.g.,' as a multi-word signal", () => {
      const md = "X is true. See, e.g., [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see, e.g.,");
    });

    it("detects 'See also' as a signal", () => {
      const md = "X is true. See also [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see also");
    });

    it("detects 'See generally' as a signal", () => {
      const md = "X is true. See generally [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see generally");
    });

    it("detects 'Cf.' as a signal", () => {
      const md = "X is true. Cf. [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("cf.");
    });

    it("detects 'But see' as a signal", () => {
      const md = "X is true. But see [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("but see");
    });

    it("detects 'But cf.' as a signal", () => {
      const md = "X is true. But cf. [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("but cf.");
    });

    it("detects 'Accord' as a signal", () => {
      const md = "X is true. Accord [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("accord");
    });

    it("detects 'Compare' as a signal", () => {
      const md = "X is true. Compare [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("compare");
    });

    it("detects italicized *See* as a signal", () => {
      const md = "X is true. *See* [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see");
    });

    it("detects italicized _See_ as a signal", () => {
      const md = "X is true. _See_ [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see");
    });

    it("leaves signal undefined when none precedes", () => {
      const md = "X is true [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBeUndefined();
    });

    it("applies signal to all cites in a multi-cite group", () => {
      const md = "X is true. See [@Foo2020-aa; @Bar2021-bb].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(2);
      expect(cites[0].signal).toBe("see");
      expect(cites[1].signal).toBe("see");
    });
  });

  describe("parenthetical extraction", () => {
    it("extracts parenthetical immediately after cite", () => {
      const md = "Body sentence here [@Hirst2022-pq] (quoting Smith).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].parenthetical).toBe("quoting Smith");
      expect(cites[0].claim).toBe("quoting Smith");
    });

    it("preserves body sentence as bodyContext when parenthetical present", () => {
      const md = "Body sentence here [@Hirst2022-pq] (quoting Smith).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].bodyContext).toBeDefined();
      expect(cites[0].bodyContext).toContain("Body sentence here");
    });

    it("extracts parenthetical with locator: [@key, p. 42] (showing X)", () => {
      const md = "Body sentence [@Hirst2022-pq, p. 42] (showing X).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].locator).toBe("p. 42");
      expect(cites[0].parenthetical).toBe("showing X");
      expect(cites[0].claim).toBe("showing X");
    });

    it("multi-cite shares parenthetical across all cites", () => {
      const md = "Some text [@Foo2020-aa; @Bar2021-bb] (collectively, on point).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(2);
      expect(cites[0].parenthetical).toBe("collectively, on point");
      expect(cites[1].parenthetical).toBe("collectively, on point");
      expect(cites[0].claim).toBe("collectively, on point");
      expect(cites[1].claim).toBe("collectively, on point");
    });

    it("falls back to body sentence when no parenthetical", () => {
      const md = "Body sentence here [@Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].parenthetical).toBeUndefined();
      expect(cites[0].claim).toContain("Body sentence here");
      expect(cites[0].bodyContext).toBeUndefined();
    });

    it("allows whitespace between cite bracket and parenthetical", () => {
      const md = "Body sentence [@Hirst2022-pq]  (with extra spaces).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].parenthetical).toBe("with extra spaces");
    });

    it("does not capture distant parenthetical", () => {
      const md = "Sentence [@Hirst2022-pq] and other text (not a parenthetical).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].parenthetical).toBeUndefined();
    });

    it("(see fn) marker does not collide with parenthetical extraction", () => {
      // A footnote-indirected cite has footnoteContext set; the (see fn)
      // string is added by the report renderer, not the extractor. Ensure
      // we don't accidentally pick up a "(see fn)" suffix by mistake when
      // the footnote body has parens.
      const md = [
        "Body claim here.[^1]",
        "",
        "[^1]: According to [@key2024] (an empirical study).",
        "",
      ].join("\n");
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].bibkey).toBe("key2024");
      // The parenthetical IS captured (it's right after the cite).
      expect(cites[0].parenthetical).toBe("an empirical study");
      // footnoteContext is still set (footnote body, sans cite).
      expect(cites[0].footnoteContext).toBeDefined();
    });

    it("signal + parenthetical coexist: 'See [@key] (showing X)'", () => {
      const md = "X is true. See [@Hirst2022-pq] (showing relevant data).";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].signal).toBe("see");
      expect(cites[0].parenthetical).toBe("showing relevant data");
      expect(cites[0].claim).toBe("showing relevant data");
    });
  });

  describe("pandoc-crossref filter", () => {
    it("skips [@tbl:foo]", () => {
      const cites = extractCitations("See [@tbl:foo] for results.", "/tmp/x.md");
      expect(cites).toEqual([]);
    });

    it("skips [@fig:diagram]", () => {
      const cites = extractCitations(
        "As shown in [@fig:diagram].",
        "/tmp/x.md",
      );
      expect(cites).toEqual([]);
    });

    it("skips [@sec:intro]", () => {
      const cites = extractCitations(
        "See [@sec:intro] above.",
        "/tmp/x.md",
      );
      expect(cites).toEqual([]);
    });

    it("skips [@eq:e1] and [@lst:listing]", () => {
      const cites = extractCitations(
        "See [@eq:e1] and [@lst:listing].",
        "/tmp/x.md",
      );
      expect(cites).toEqual([]);
    });

    it("keeps regular cites alongside crossref refs", () => {
      const md = "See [@Hirst2022-pq] alongside [@tbl:foo].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].bibkey).toBe("Hirst2022-pq");
    });

    it("filters crossref out of mixed multi-cite [@tbl:x; @Hirst2022-pq]", () => {
      const md = "Mixed group [@tbl:x; @Hirst2022-pq].";
      const cites = extractCitations(md, "/tmp/x.md");
      expect(cites.length).toBe(1);
      expect(cites[0].bibkey).toBe("Hirst2022-pq");
    });
  });
});
