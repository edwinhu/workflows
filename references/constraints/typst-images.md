---
name: typst-images
description: Images must be centered with #align(center) — Typst defaults to left-aligned; figures come from the source, never recreated from memory
type: convention
graduated: false
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule — Images

**Images should be paper figures extracted during the Phase 1 inventory.** If an image is a synthesized diagram (not from the paper), document the decision. Paper figures are the authoritative visual source — never recreate a figure from memory.

Images and figures must be centered on slides. Typst defaults to left-aligned.

```typst
// CORRECT
#align(center)[#image("assets/figure.png")]

// WRONG (left-aligned by default)
#image("assets/figure.png")
```

The same holds for lecture assets referenced by relative path:

```typst
// CORRECT
#align(center)[#image("../../assets/ipo-gross-spreads.png")]

// WRONG — left-aligned by default
#image("../../assets/ipo-gross-spreads.png")
```
