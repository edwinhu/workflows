---
name: typst-bullet-spacing
description: Blank lines between ALL top-level bullet items in Typst slides and notes — no exceptions; also applies to ordered lists
type: convention
graduated: true
check-script: bullet-spacing.py
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule

**Blank lines between ALL top-level bullet items.** No exceptions.

```typst
// CORRECT
- First point

- Second point

- Third point
```

```typst
// WRONG
- First point
- Second point
- Third point
```

## Bullet Spacing in Slides

Separate `-` bullet items with blank lines. This creates paragraph spacing between bullets in the rendered output, giving more breathing room on projected slides.

```typst
// CORRECT: blank lines between bullets
- Issuer bankrupt; officers fled #pause

- *Underwriters*, *auditors*, *lawyers* remain solvent #pause

- Gatekeepers can prevent fraud at lower cost
```

```typst
// WRONG: no blank lines (renders tightly packed)
- Issuer bankrupt; officers fled #pause
- *Underwriters*, *auditors*, *lawyers* remain solvent #pause
- Gatekeepers can prevent fraud at lower cost
```

This also applies to `+` (ordered lists) and numbered lists (`1.`, `2.`, etc.). Enforced by `bullet-spacing.py` (auto-discovered by `check-all.py`).
