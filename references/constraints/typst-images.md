---
name: typst-images
description: Images must be centered with #align(center) — Typst defaults to left-aligned
applies-to: [workshop, workshop-revise]
---

## Rule

Images must be centered on slides. Typst defaults to left-aligned.

```typst
// CORRECT
#align(center)[#image("assets/figure.png")]

// WRONG (left-aligned by default)
#image("assets/figure.png")
```
