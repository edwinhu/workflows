---
name: typst-images
description: Images must be centered with #align(center) — Typst defaults to left-aligned
applies-to: [workshop, workshop-revise]
---

## Rule

**Images should be paper figures extracted during the Phase 1 inventory.** If an image is a synthesized diagram (not from the paper), document the decision. Paper figures are the authoritative visual source — never recreate a figure from memory.

Images must be centered on slides. Typst defaults to left-aligned.

```typst
// CORRECT
#align(center)[#image("assets/figure.png")]

// WRONG (left-aligned by default)
#image("assets/figure.png")
```
