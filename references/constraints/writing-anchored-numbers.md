---
name: writing-anchored-numbers
description: Empirical numbers in prose must be anchored to a Table or Figure — but anchors inherit across paragraphs within the same subsection
applies-to: [writing-draft, writing-verify, writing-revise]
---

## Rule

Every subsection that discusses empirical numbers must anchor those numbers to a Table, Figure, or Panel. The anchor should appear in or before the first number-bearing sentence of the subsection — typically in the subsection opener ("Table 3 reports...").

**Once a Table or Figure is anchored in a subsection, subsequent paragraphs in the same subsection that discuss numbers from the same source inherit the anchor and need not re-cite.** A paragraph may re-cite voluntarily for emphasis or when transitioning from one table to another, but repetition is not required.

When a subsection discusses a NEW table that was not introduced earlier, that new table must be anchored when it first appears.

Empirical numbers include: percentages, decimal statistics, coefficients, sample sizes, dollar/currency amounts, and counts derived from data.

## What Does Not Require Anchoring

- **Years and dates**: "in 2018", "from 1996 to 2023"
- **Regulatory/legal thresholds**: "5% threshold", "Rule 14a-8", "Section 13(d)"
- **Section/Part cross-references**: "Part II", "Section 3"
- **Round rhetorical numbers**: "thousands of", "one in three", "dozens"
- **Definitional counts**: "the three largest index fund families", "all fifty states"
- **Numbers inside footnotes**: footnotes may cite differently
- **Numbers in headings or frontmatter**
- **Numbers that restate or reference a finding anchored earlier in the same subsection**: e.g., if paragraph 1 of a subsection cites "15 flips (Table 2)", paragraph 3 may write "the 15 flips concentrate in management proposals" without re-citing
- **Part-level intro or lede paragraphs**: the Part opener summarizes findings stated elsewhere; anchoring happens in the subsection that develops each number
- **Abstract sections** (heading "Abstract"): the abstract summarizes findings anchored in the body of the paper; requiring table pointers in an abstract produces citation-cluttered prose that defeats the purpose of an abstract

## Rationale

Un-anchored numbers make claims the reader cannot verify without hunting through the tables. Anchoring is a basic credibility signal: it tells the reader "you can check this."

The per-subsection rule (rather than per-paragraph) reflects natural empirical prose flow: a subsection typically discusses one or two tables across several paragraphs, with the topic opener establishing the source. Requiring per-paragraph anchoring in a law-review section that cites twenty or more numbers drawn from the same table produces cluttered, repetitive prose — exactly the kind of robotic repetition the rule's underlying purpose is to avoid.

Lede paragraphs at the start of a Part are exempt because they state headline findings that each subsection develops in detail; the anchoring happens where the development occurs. Requiring a table pointer in a two-sentence Part opener ("X flipped 2,905; Y flipped 15") forces table-of-contents prose that Volokh and similar style guides explicitly reject.

## Examples

**Per-subsection anchoring (right)**:
```markdown
### Where the mirror flips occur

Flips concentrate in management proposals and shareholder proposals;
no director election produces a flip. Table 3 reports the full category
decomposition.

Director elections account for zero of the 15 flips. Other management
proposals account for 13 flips (86.7%). Shareholder proposals filed
under Rule 14a-8 account for the remaining 2 (13.3%).

The uniform pro-management skew reflects the item composition: on
routine management proposals where the current index-fund vote happened
to diverge slightly from management, the non-indexed shareholders were
more supportive of the board than the index-fund stewardship teams.
```
(Table 3 is anchored in paragraph 1. Paragraphs 2 and 3 discuss numbers from Table 3 without re-citing.)

**New table introduced mid-subsection (right)**:
```markdown
Table 3 shows that index funds support management 89.3% of the time.
Holding periods are considerably longer: Table 4 reports a mean of
4.2 years and turnover of just 3.1%.
```

**Wrong — no anchor anywhere in the subsection**:
```markdown
### Where the mirror flips occur

Flips concentrate in management proposals and shareholder proposals.

Director elections account for zero of the 15 flips. Other management
proposals account for 13 flips (86.7%).
```
(No Table 3 reference anywhere in the subsection; reader cannot locate the source.)

**Acceptable — Part-level lede**:
```markdown
# Part III. Findings

Full abstention would have flipped 2,905 outcomes and triggered quorum
failures on tens of thousands of additional meetings. Market mirroring
would have flipped 15.
```
(Part opener; no table anchor required. The 2,905, quorum failure, and 15 numbers are each developed in subsections A and B that anchor their respective tables.)

## Detection Heuristic

For each `drafts/*.md` section, treat the heading structure (`##`, `###`) as defining **subsections**:

1. **Identify the subsection**: body from a `##` or `###` heading to the next heading of the same or higher level.
2. **Identify empirical numbers** in the subsection body: match `\d+[.,]\d+%?`, `\$[\d,.]+`, `\d{2,}%`, or `\d{1,3}(,\d{3})+` — but exclude years (`\b(19|20)\d{2}\b`), section/rule references (`(?:Section|Part|Rule|Chapter)\s+\d`), and footnote markers.
3. **Check for an anchor anywhere in the subsection**: search for `Table\s+\d`, `Figure\s+\d`, `Panel\s+[A-Z]`, `Appendix\s+[A-Z]`, or `Column\s+\d` (case-insensitive).
4. **Flag only if** empirical numbers are present but no anchor appears anywhere in the subsection body.
5. **Exempt Part-level lede**: the body text between a Part-title heading (`#`) and the first `##` heading is exempt from anchoring requirements.

False positives are acceptable — the check is a first-pass filter. The reviewer subagent applies judgment for edge cases (rhetorical numbers, well-known statistics, Part-level summaries).

## Anchoring Facts

- Body text must be self-contained: a footnote citing the table does not substitute for an in-body anchor at the subsection opening.
- Numbers multiply during revision, so anchors deferred to "final editing" never get added — anchor during drafting.
- A number whose source is "obvious from context" either doesn't need to appear (cut it) or needs the once-per-subsection anchor like any other.
