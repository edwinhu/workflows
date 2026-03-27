---
name: typst-tables
description: Table inset minimum 10pt — smaller values produce cramped, unreadable tables on projected slides
applies-to: [workshop, workshop-revise]
---

## Rule

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
