import { describe, expect, it } from "bun:test";
import {
  tokenize,
  normalize,
  bestLcsSpan,
  verifyGrounding,
  type Token,
  type GroundingResult,
} from "../grounding";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("splits text into word tokens with char positions", () => {
    const tokens = tokenize("Hello world");
    expect(tokens).toHaveLength(2);
    expect(tokens[0].text).toBe("Hello");
    expect(tokens[0].charStart).toBe(0);
    expect(tokens[0].charEnd).toBe(5);
    expect(tokens[1].text).toBe("world");
    expect(tokens[1].charStart).toBe(6);
    expect(tokens[1].charEnd).toBe(11);
  });

  it("handles punctuation as separate tokens", () => {
    const tokens = tokenize("end.");
    expect(tokens).toHaveLength(2);
    expect(tokens[0].text).toBe("end");
    expect(tokens[1].text).toBe(".");
  });

  it("preserves positions through multi-byte and mixed content", () => {
    const text = "page 42: the results";
    const tokens = tokenize(text);
    // Verify round-trip: slicing original text at char positions recovers token
    for (const t of tokens) {
      expect(text.slice(t.charStart, t.charEnd)).toBe(t.text);
    }
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toHaveLength(0);
  });

  it("handles newlines and tabs as whitespace", () => {
    const tokens = tokenize("line one\nline\ttwo");
    expect(tokens.map((t) => t.text)).toEqual(["line", "one", "line", "two"]);
  });
});

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

describe("normalize", () => {
  it("lowercases", () => {
    expect(normalize("Hello")).toBe("hello");
  });

  it("strips trailing s for words > 3 chars not ending in ss", () => {
    expect(normalize("markets")).toBe("market");
    expect(normalize("class")).toBe("class"); // ends in ss
    expect(normalize("bus")).toBe("bus"); // length <= 3
  });

  it("handles empty string", () => {
    expect(normalize("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// LCS aligner
// ---------------------------------------------------------------------------

describe("bestLcsSpan", () => {
  it("finds exact substring match", () => {
    const source = "the quick brown fox jumps over the lazy dog".split(" ");
    const passage = "brown fox jumps".split(" ");
    const span = bestLcsSpan(source, passage);
    expect(span).not.toBeNull();
    expect(span!.matches).toBe(3);
    expect(span!.startIdx).toBe(2); // "brown"
    expect(span!.endIdx).toBe(4); // "jumps"
  });

  it("handles fuzzy match with inserted words", () => {
    // Source has extra word "very" between "the" and "lazy"
    const source = "the quick brown fox jumps over the very lazy dog".split(" ");
    const passage = "the lazy dog".split(" ");
    const span = bestLcsSpan(source, passage);
    expect(span).not.toBeNull();
    expect(span!.matches).toBe(3);
  });

  it("returns null for no match", () => {
    const source = "alpha beta gamma".split(" ");
    const passage = "delta epsilon zeta".split(" ");
    const span = bestLcsSpan(source, passage);
    expect(span).toBeNull();
  });

  it("handles single-token passage", () => {
    const source = "hello world".split(" ");
    const passage = ["world"];
    const span = bestLcsSpan(source, passage);
    expect(span).not.toBeNull();
    expect(span!.matches).toBe(1);
    expect(span!.startIdx).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end grounding verification
// ---------------------------------------------------------------------------

describe("verifyGrounding", () => {
  const sourceText = `
    Securities fraud liability under Section 10(b) requires proof of
    scienter, which the Supreme Court has defined as a mental state
    embracing intent to deceive, manipulate, or defraud. In Tellabs v.
    Makor Issues & Rights, the Court held that a securities fraud
    complaint must state with particularity facts giving rise to a strong
    inference of scienter.
  `.trim();

  it("grounds a verbatim passage", () => {
    const passage =
      "a mental state embracing intent to deceive, manipulate, or defraud";
    const result = verifyGrounding(passage, sourceText);
    expect(result.grounded).toBe(true);
    expect(result.coverage).toBeGreaterThanOrEqual(0.75);
    expect(result.density).toBeGreaterThanOrEqual(0.33);
    // The matched region should contain the passage text
    expect(result.matchedText).toBeTruthy();
    expect(result.matchedText!.toLowerCase()).toContain("mental state");
  });

  it("grounds a near-verbatim passage with minor differences", () => {
    // Slight paraphrase: "defined as" → "described as" (1 word diff)
    const passage =
      "the Supreme Court has described as a mental state embracing intent to deceive";
    const result = verifyGrounding(passage, sourceText);
    // Should still ground since most tokens match
    expect(result.grounded).toBe(true);
  });

  it("rejects a fabricated passage", () => {
    const passage =
      "the efficient market hypothesis implies that stock prices reflect all publicly available information";
    const result = verifyGrounding(passage, sourceText);
    expect(result.grounded).toBe(false);
  });

  it("rejects empty passage", () => {
    const result = verifyGrounding("", sourceText);
    expect(result.grounded).toBe(false);
  });

  it("handles passage with different capitalization", () => {
    const passage = "SECURITIES FRAUD LIABILITY UNDER SECTION 10(B)";
    const result = verifyGrounding(passage, sourceText);
    expect(result.grounded).toBe(true);
  });

  it("handles pluralization differences", () => {
    // "complaint" vs "complaints" should still match via normalize
    const passage =
      "securities fraud complaints must state with particularity facts giving rise to a strong inference";
    const result = verifyGrounding(passage, sourceText);
    expect(result.grounded).toBe(true);
  });

  it("respects custom thresholds", () => {
    // Passage that partially overlaps — ~60% of tokens present in source
    // (below 0.85 setCoverage, so unconditional acceptance doesn't apply).
    // "securities fraud liability under Section 10 b" has overlap, but
    // "alleged", "significant", "corporate", "wrongdoing" are NOT in source.
    const passage =
      "securities fraud liability under Section alleged significant corporate wrongdoing";
    const strict = verifyGrounding(passage, sourceText, {
      coverageThreshold: 0.95,
    });
    const lenient = verifyGrounding(passage, sourceText, {
      coverageThreshold: 0.5,
    });
    // Lenient should accept (enough contiguous tokens match)
    expect(lenient.grounded).toBe(true);
    // Strict (95% coverage) should reject since many words are absent
    expect(strict.grounded).toBe(false);
  });

  it("returns char offsets for grounded passage", () => {
    const passage = "Tellabs v. Makor Issues & Rights";
    const result = verifyGrounding(passage, sourceText);
    expect(result.grounded).toBe(true);
    expect(result.charStart).toBeDefined();
    expect(result.charEnd).toBeDefined();
    // Verify the offsets point to the right region
    const slice = sourceText.slice(result.charStart!, result.charEnd!);
    expect(slice.toLowerCase()).toContain("tellabs");
  });

  it("handles decomposed unicode (NFD vs NFC)", () => {
    const source = "The caf\u00E9 served r\u00E9sum\u00E9 reviews";
    const passage = "cafe\u0301 served re\u0301sume\u0301";
    const result = verifyGrounding(passage, source);
    expect(result.grounded).toBe(true);
  });

  it("handles fi/fl ligatures from PDF extraction", () => {
    const source = "The \uFB01ndings con\uFB01rm the e\uFB00ect";
    const passage = "findings confirm the effect";
    const result = verifyGrounding(passage, source);
    expect(result.grounded).toBe(true);
  });

  it("rejects scattered matches failing density gate", () => {
    // Passage tokens: only 2 of 6 exist in source (setCoverage ~0.33 < 0.85)
    // so unconditional acceptance doesn't apply, and density gate rejects
    const source = "alpha x x x x x x x x x x x x x x beta x x x x x x x x x x x x x x gamma";
    const passage = "alpha beta zeta omega delta epsilon";
    const result = verifyGrounding(passage, source, { coverageThreshold: 0.75, densityThreshold: 0.5 });
    expect(result.grounded).toBe(false);
  });

  it("handles repeated tokens in passage", () => {
    const source = "the court held the defendant the liable party";
    const passage = "the defendant the liable";
    const result = verifyGrounding(passage, source);
    expect(result.grounded).toBe(true);
  });

  it("rejects passage longer than source", () => {
    const source = "short text";
    const passage = "this is a much longer passage that cannot possibly be found in the short source text above";
    const result = verifyGrounding(passage, source);
    expect(result.grounded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Accent stripping in normalize
// ---------------------------------------------------------------------------

describe("normalize - accent stripping", () => {
  it("strips accents for matching", () => {
    expect(normalize("résumé")).toBe("resume");
    expect(normalize("café")).toBe("cafe");
    expect(normalize("naïve")).toBe("naive");
  });
});
