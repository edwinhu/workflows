---
name: bluebook
description: "ALWAYS use for ANY legal citation question, even if the user never says 'Bluebook' - 'cite this case', 'how do I cite a statute', 'is this footnote formatted right', 'id. or supra here', 'cite a law review article', 'what signal goes here', 'format these footnotes', 'short form for this cite', 'block quote this', 'where does the ellipsis go', 'is this quote altered right', or writing or checking any citation or quotation in a legal manuscript. NOT for auditing a whole manuscript's footnotes (use bluebook-audit) and NOT for rendering these rules in Typst (use docx-typst)."
user-invocable: false
---

# Bluebook 21st Edition Citation

Citation formatting for law reviews and legal scholarship per *The Bluebook: A Uniform System of Citation* (21st ed. 2020).

**Announce:** "I’m using the bluebook skill for citation formatting."

## When to Use

Invoke this skill for:
- Formatting case citations (federal, state, foreign)
- Statutory and regulatory citations
- Secondary sources (books, articles, treatises)
- Short form citations (id., supra, hereinafter)
- Introductory signals and parentheticals
- Citation sentences vs. citation clauses

**For legal writing style**: Use `/writing-legal` skill (Volokh)
**For general writing**: Use `/writing` skill (Strunk & White)

**To RENDER these rules in a Typst manuscript**: this skill states the rules; it does
not implement them. `docx-typst` carries the implementation — `assets/bluebook.typ` is a
`#show cite:` rule supplying the three things typst's built-in bibliography cannot
(`supra note N`, small-caps reporters, `shortjournal` → `container-title-short`), because
hayagriva is statically linked into the typst binary and renders none of them. Reach for
it whenever a Typst document needs the short forms in `references/short-forms.md` to
renumber themselves rather than be typed by hand.

<EXTREMELY-IMPORTANT>
## IRON LAW #1: NO CITATION WITHOUT VERIFICATION

**If you haven’t verified EVERY element of a citation, DO NOT write it.**

Before writing ANY citation:
1. Verify case name spelling and procedural posture
2. Verify reporter volume and page numbers
3. Verify court and year
4. Verify pinpoint page exists

**Guessing reporter volumes or page numbers is NOT HELPFUL — the user publishes with wrong citations that fail verification. Period.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## IRON LAW #2: NO SHORT FORMS WITHOUT FULL CITATION FIRST

**Id., supra, and hereinafter REQUIRE a preceding full citation.**

Before using ANY short form:
1. Locate the full citation in the document
2. Verify no intervening citations (for id.)
3. Verify the supra reference is unambiguous

**Using id. after intervening citations creates ambiguity. Delete and cite in full.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## IRON LAW #3: FOOTNOTE VS. TEXT CITATION FORMAT

**Law review citations use footnote format (Rule 1). Court documents use text format (Bluepages).**

```
FOOTNOTE (law reviews):    Smith v. Jones, 500 U.S. 1, 5 (1991).
TEXT (court documents):    Smith v. Jones, 500 U.S. 1, 5 (1991)

FOOTNOTE (statutes):       18 U.S.C. § 1001 (2018).
TEXT (statutes):           18 U.S.C. § 1001 (2018)
```

**If writing for a law review and using text format conventions, DELETE and reformat.**
</EXTREMELY-IMPORTANT>

## The Gate Function

Before writing ANY citation:

```
1. IDENTIFY → What type of source? (case, statute, article, book)
2. LOCATE   → Find the correct rule in Bluebook
3. VERIFY   → Confirm ALL elements (volume, page, court, year)
4. FORMAT   → Apply correct typeface and punctuation
5. CHECK    → Does this match examples in the rule?
6. WRITE    → Only after steps 1-5
```

**Skipping any step produces unreliable citations.**

## Citation Facts

- An intervening citation breaks *id.* — *id.* after an intervening cite is ambiguous and must become a full short form. *Supra* only works when the full citation it points to actually exists earlier in the document.
- Signals are checked against Rule 1.2 examples, not intuition — a wrong signal misleads the reader about how the source supports the proposition.
- Parentheticals explain the source's relevance; pinpoints prove the specific claim. A cite deferred ("I'll add the pinpoint later") ships without one.
- Typeface (Rule 2) is mandatory, not stylistic. Abbreviations come from tables T6, T10, T12 — "common" or "obvious" abbreviations that don't match the tables fail cite-check.
- "Pretty sure" about a reporter volume or page number means unverified — a guessed element presented as a citation is an unverified claim, and exact pinpoints are required.

## Quick Reference: Common Citation Forms

### Cases (Rule 10)

```
Full citation:
Brown v. Board of Education, 347 U.S. 483, 495 (1954).

Short form (same footnote or five footnotes with no intervening):
Id. at 496.

Short form (different footnote, no intervening):
Brown, 347 U.S. at 497.

Short form (intervening citations):
Brown v. Board of Education, 347 U.S. at 498.
```

### Statutes (Rule 12)

```
Full citation:
42 U.S.C. § 1983 (2018).

Multiple sections:
42 U.S.C. §§ 1983-1985 (2018).

Short form:
§ 1983 or id. § 1984
```

### Law Review Articles (Rule 16)

```
Full citation:
Cass R. Sunstein, *On the Expressive Function of Law*, 144 U. Pa. L. Rev. 2021, 2030 (1996).

Short form:
Sunstein, supra note 12, at 2035.
```

### Books (Rule 15)

```
Full citation:
Richard A. Posner, Economic Analysis of Law 45 (9th ed. 2014).

Short form:
Posner, supra note 5, at 52.
```

## Typeface Rules (Rule 2)

| Source Type | Law Review Format |
|-------------|-------------------|
| Case names | Italics: *Brown v. Board* |
| Book titles | Small caps: ECONOMIC ANALYSIS OF LAW |
| Article titles | Italics: *On the Expressive Function* |
| Journal names | Small caps: U. PA. L. REV. |
| Periodical names (non-consecutively paginated) | Italics: *N.Y. Times* |
| Statutes | Roman: 42 U.S.C. § 1983 |

## Introductory Signals (Rule 1.2)

| Signal | Meaning | Use When |
|--------|---------|----------|
| [no signal] | Direct support | Source directly states proposition |
| *See* | Implicit support | Source supports but doesn’t directly state |
| *See, e.g.,* | One of several | Multiple sources support; citing representative |
| *Cf.* | Analogous support | Source supports by analogy |
| *Compare* ... *with* | Comparison | Sources illustrate through contrast |
| *See generally* | Background | Source provides helpful background |
| *But see* | Contradiction | Source contradicts proposition |
| *Contra* | Direct contradiction | Source directly contradicts |

### Signal Order (Rule 1.3)

Within a single citation sentence, signals appear in this order:
1. [no signal]
2. *E.g.,*
3. *Accord*
4. *See*
5. *See also*
6. *Cf.*
7. *Compare*
8. *Contra*
9. *But see*
10. *But cf.*
11. *See generally*

## Common Errors Checklist

### Case Citations

- [ ] Party names shortened properly (omit "Inc.", "Ltd." unless only identifier)
- [ ] "United States" abbreviated to "U.S." (as party, not "United States of America")
- [ ] Reporter abbreviation matches T1
- [ ] Court identifier included unless obvious from reporter
- [ ] Year is decision year, not argument year
- [ ] Pinpoint included for specific propositions

### Statutory Citations

- [ ] Current official code used (not session laws for current statutes)
- [ ] Section symbol (§) used, not "Section"
- [ ] Space between § and number
- [ ] Year is code edition year, not enactment year
- [ ] Supplements cited when applicable

### Short Forms

- [ ] Full citation appears earlier in same document
- [ ] Id. used only when no intervening citation
- [ ] Supra refers to footnote number where full cite appears
- [ ] Hereinafter defined in first full citation

## Progressive Disclosure

For detailed rules, consult:

### Reference Files

- **`references/cases.md`** - Complete case citation rules (R. 10)
- **`references/statutes.md`** - Statutory and regulatory citations (R. 12-14)
- **`references/secondary-sources.md`** - Books, articles, treatises (R. 15-17)
- **`references/short-forms.md`** - Id., supra, hereinafter rules (R. 4)
- **`references/quotations.md`** - Block quotes, alterations, ellipses (R. 5)
- **`references/signals-parentheticals.md`** - Signals, parentheticals, order (R. 1)
- **`references/audit-patterns.md`** - Citation audit patterns and validation
- **`references/abbreviations.md`** - Bluebook abbreviation tables

### NotebookLM Integration

**Its coverage is narrow — check the rule is in it before believing an answer.** The notebook's
one source is a 53-page scanned excerpt (`annas-arch-….pdf`). Verified 2026-08-23 by asking it:
the only FULL rule text present is **Rule 1 and 1.1-1.4** (pp. 51, 53), plus the Quick Reference
tables. Everything else is cover scans, copyright pages, and cropped strips of the printed book's
**thumb tabs** — so "rule 10", "rule 12" appear as tab labels with no text behind them, and a
model asked what the PDF contains will read those tabs and confidently name rules it cannot quote.
It did exactly that here before retracting under stricter questioning.

**It cannot answer on Rule 5 (quotations) at all**, which is why
`references/quotations.md` is still unverified.

**Refuse the web-research offer.** On a rule it does not hold, the notebook replies "Would you
like me to perform some web research?" — observed three times. Accepting turns a web search into
something formatted as a source-grounded answer, which is how an unverified reference file gets
written by an author who believes they consulted the book.

For Rule 1, signals, or the Quick Reference tables, query the Bluebook 21e (2020) notebook:

```bash
# Notebook ID: f70a9976-b443-43d5-b5fd-43ff86b2b700
# `nlm` is on PATH (nix-managed). Add --citations list to get the Bluebook text
# behind the answer; an unsourced answer from a notebook is not a rule.

# Query specific Bluebook rules
nlm generate-chat f70a9976-b443-43d5-b5fd-43ff86b2b700 "How do I cite an unpublished opinion under Rule 10.8.1?"

# Get rule clarification
nlm generate-chat f70a9976-b443-43d5-b5fd-43ff86b2b700 "What are the typeface conventions for treaty citations?"

# Verify abbreviation tables
nlm generate-chat f70a9976-b443-43d5-b5fd-43ff86b2b700 "What is the correct abbreviation for 'Environmental' in journal names per Table T13?"
```

**When to query the notebook:**
- Rule wording is ambiguous in reference files
- Formatting international or specialized materials
- Checking obscure abbreviations not in quick reference
- Resolving conflicts between rules
- Understanding historical changes from previous editions

### When to Load References

Load the specific reference when:
- Formatting an unfamiliar source type
- Encountering edge cases (unpublished cases, foreign sources)
- Checking state-specific reporter requirements
- Working with complex statutory schemes
- Formatting international materials

## Integration

Use with `/writing-legal` for complete legal scholarship workflow:
1. `/bluebook` formats citations correctly
2. `/writing-legal` ensures argument structure and evidence handling
3. `/ai-anti-patterns` catches AI writing indicators before submission

## Delete & Restart Pattern

**When to delete and restart:**

1. **Citation uses guessed page numbers** → Delete, verify source, cite with real numbers
2. **Id. follows intervening citation** → Delete id., use full short form
3. **Wrong signal used** → Delete, reread Rule 1.2, apply correct signal
4. **Typeface incorrect** → Delete, apply Rule 2 typeface
5. **Abbreviation doesn’t match Bluebook tables** → Delete, use table abbreviation

**How to restart:**

```
Old: See Smith v. Jones, 500 U.S. at 15. Id. at 20. [intervening cite] Id. at 25.
New: See Smith v. Jones, 500 U.S. at 15. Id. at 20. [intervening cite] Smith, 500 U.S. at 25.
```

The third cite cannot use id. after an intervening citation.
