---
name: typst-section-hierarchy
description: Heading hierarchy =/==/=== must mirror the source's organizational structure — the paper's outline (workshop) or the casebook TOC from the inventory (lecture-prep)
type: convention
graduated: partial
check-script: scripts/check-section-hierarchy.py (typst query + inventory cross-reference)
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule — Section Hierarchy

The slide heading hierarchy must mirror the source's organizational structure: for workshop decks, the paper's structure as captured in `.planning/OUTLINE.md`; for lecture decks, the casebook's table of contents as captured in the per-lecture inventory, whose `##` sections are the authoritative source.

- `= Major Section` — the source's main sections (Introduction, Literature Review, Model, Results; or roman-numeral casebook sections I, II, II.A, II.B)
- `== Sub-topic` — subsections, key arguments, case studies, empirical results, hypotheticals, doctrinal sub-topics
- `=== Slide Subtitle` — takeaway sentence for this specific slide (not a topic label)

In lecture decks the CP ref `(CP XX--YY)` goes on the **first** `===` only, and **only for cases and casebook hypotheticals** — not for doctrinal overviews, policy discussions, statutory sections, or other content types that don't correspond to specific casebook pages.

### Paper Structure Mapping

| Paper structure | Slide heading level | Example |
|----------------|---------------------|---------|
| Major numbered section (I, II, III) | `=` | `= The Market for Proxy Advisory Services` |
| Subsection or key argument | `==` | `== Free-Riding on Governance` |
| Individual slide takeaway | `===` | `=== Two firms control over 90% of the market.` |

**Every `=` heading must correspond to a major paper section.** No orphan `=` headings that don't track the paper's structure.

### Casebook TOC Mapping

The inventory's `##` headings determine both the presence and level of slide headings:

| Inventory `##` heading | Slide heading level | Example |
|------------------------|---------------------|---------|
| Roman-numeral prefix (I., II.A., III.) | `=` | `## II.B. Waiting Period` → `= Waiting Period` |
| Everything else | `==` | `## Hypothetical Three — Rule 135` → `== Hypothetical Three --- Rule 135` |

**Every inventory `##` section must have a corresponding `=` or `==` heading at the correct level.** Every `=` heading must correspond to a roman-numeral inventory section — no orphan `=` headings that don't track the casebook TOC.

**Why:** The slide deck TOC is what the presenter navigates during class. If the heading structure doesn't mirror the source, navigation during the talk breaks down.

### Slide Subtitles (`===`)

Subtitles must be **complete sentences** — takeaway statements, not topic labels.

```typst
// GOOD: takeaway sentence
=== Proxy advisors emerged to fill a governance gap left by dispersed ownership.

// BAD: topic label
=== Proxy Advisors Overview
```

### Long Sections

If a `==` section has more than 10 `===` subtitles, consider breaking it into sub-sections with additional `==` headings. This is a signal, not a hard rule — but 24 subtitles under one `==` is too many to navigate.

### Discussion Question Sequence Rule

In a `==` section with 3+ discussion question slides, the **first slide must NOT be a numbered DQ**. It should introduce the case or topic with a descriptive subtitle (e.g., facts diagram, case setup). DQ numbering (`Discussion Questions X of N`) starts on the second slide. N counts only the numbered DQ slides, not the introductory slide.

**GOOD:**
```typst
== _Dirks v. SEC_

#slide[
=== Secrist tipped Dirks about massive fraud at EFA; Dirks told his clients, who sold before the scandal broke.
// facts diagram here
]

#slide[
=== Discussion Questions 1 of 5
// questions here
]
```

**BAD (numbered DQ as first slide):**
```typst
== _Dirks v. SEC_

#slide[
=== Discussion Questions 1 of 6
// facts diagram crammed into a numbered DQ slide
]
```

No TM references in student-facing materials.

### Additional Rules

- `==` headings go OUTSIDE `#slide[...]` blocks (they are section dividers, not slide content).
- Notes file `==` sections must match slides `=` sections. Where a per-lecture slides file carries its own `==` sections, notes and slides sections are matched **positionally, not by name**: `check-notes-alignment.sh` compares the n-th `==` section on each side and the two sides may use different heading names.
- Related hypos (HYPO-* items) may be grouped under a single `==` category heading to prevent bloat; each hypo still gets its own `===` subtitle.
