---
name: typst-section-hierarchy
description: Heading hierarchy =/==/=== must mirror the paper's organizational structure
applies-to: [workshop, workshop-revise]
---

## Rule

The slide heading hierarchy must mirror the paper's organizational structure as captured in `.planning/OUTLINE.md`.

- `= Major Section` — paper's main sections (Introduction, Literature Review, Model, Results, etc.)
- `== Sub-topic` — subsections, key arguments, case studies, empirical results
- `=== Slide Subtitle` — takeaway sentence for this specific slide (not a topic label)

### Paper Structure Mapping

| Paper structure | Slide heading level | Example |
|----------------|---------------------|---------|
| Major numbered section (I, II, III) | `=` | `= The Market for Proxy Advisory Services` |
| Subsection or key argument | `==` | `== Free-Riding on Governance` |
| Individual slide takeaway | `===` | `=== Two firms control over 90% of the market.` |

**Every `=` heading must correspond to a major paper section.** No orphan `=` headings that don't track the paper's structure.

### Slide Subtitles (`===`)

Subtitles must be **complete sentences** — takeaway statements, not topic labels.

```typst
// GOOD: takeaway sentence
=== Proxy advisors emerged to fill a governance gap left by dispersed ownership.

// BAD: topic label
=== Proxy Advisors Overview
```

### Additional Rules

- `==` headings go OUTSIDE `#slide[...]` blocks (they are section dividers, not slide content)
- Notes file `==` sections must match slides `=` sections
- If a `==` section has more than 10 `===` subtitles, consider splitting
