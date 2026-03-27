---
name: typst-tables
description: Table inset minimum 10pt — smaller values produce cramped, unreadable tables on projected slides
applies-to: [workshop, workshop-revise]
---

## Rule

**Tables must be grounded in the source paper.** If the table reproduces paper data (regression results, summary statistics), extract values from the paper — never type numbers from training knowledge. If the table synthesizes information for pedagogical purposes (comparison matrices, timeline summaries), document that decision in a comment.

**Minimum `inset: 10pt`.** Smaller values (2pt, 4pt, 5pt) produce cramped, unreadable tables on projected slides.

```typst
#table(
  columns: (auto, 1fr, 1fr),
  align: (left, left, left),
  stroke: 0.5pt,
  inset: 10pt,
  table.header([*Col 1*], [*Col 2*], [*Col 3*]),
  // rows...
)
```
