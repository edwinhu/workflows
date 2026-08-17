---
name: typst-sub-bullets
description: Sub-bullets use two-space indent + dash, with blank lines between — NEVER use -- as marker (renders as en-dash)
type: convention
graduated: true
check-script: sub-bullets.py
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, notes-edit, lecture-prep-edit]
---

## Rule — Nested List Items (Sub-Bullets)

Use **two-space indent + `- `** for second-level list items. Do **not** use `--` as a sub-bullet marker — in Typst, `--` renders as an en-dash character, not a list item. The template already sets `#set list(marker: ([•], [--]))` which automatically renders nested items with an en-dash marker.

Sub-bullets must be separated by blank lines — both from the parent bullet and from each other. This matches the top-level bullet spacing convention and keeps projected slides readable.

```typst
// CORRECT: blank lines between parent and sub-bullets, and between sub-bullets
- Two market imperfections undermine this:

  - *Free riding* --- investors fail to distinguish among reputations

  - *Agency problems* --- individuals may sacrifice the firm's reputation
```

```typst
// WRONG: no blank lines (renders tightly packed)
- Two market imperfections undermine this:
  - *Free riding* --- investors fail to distinguish among reputations
  - *Agency problems* --- individuals may sacrifice the firm's reputation
```

```typst
// WRONG: -- is an en-dash, not a bullet — renders as inline text
- Two market imperfections undermine this:
  -- *Free riding* --- investors fail to distinguish among reputations
  -- *Agency problems* --- individuals may sacrifice the firm's reputation
```

Enforced by `sub-bullets.py` (SUB-BULLET-SPACING) and `fake-sub-bullets.py` (FAKE-SUB-BULLET,
the sole owner of that check), both auto-discovered by `check-all.py`.
