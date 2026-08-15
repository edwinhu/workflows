---
name: typst-common-elements
description: Callout, grid, block and table shorthand — callout is for warnings only, and callout + 3 or more pause markers on one slide is overflow-prone
type: convention
graduated: partial
check-script: common-elements.py
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule

- `#callout[]` — for warnings, caveats, important notes ONLY. Not for quoting text.
- **Overflow warning:** Slides with `#callout[]` + 3 or more `#pause` markers are overflow-prone. Reduce content or split the slide.

## Common Elements

- `#callout()[text]`, `#callout(marker: emoji.quest)[question]` — for warnings, caveats, and important notes only. NOT for quoting statutory text or opinion language.
- `#grid(columns: (1fr, 1fr), gutter: 2em, [left], [right])`
- `#block(fill: rgb("#f0f0f0"), inset: 1em, radius: 5pt, width: 100%)[text]`
- `#table(columns: (auto, auto), inset: 10pt, table.header([*H1*], [*H2*]), ...)`
