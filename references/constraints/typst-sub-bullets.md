---
name: typst-sub-bullets
description: Sub-bullets use two-space indent + dash, with blank lines between — NEVER use -- as marker (renders as en-dash)
applies-to: [workshop, workshop-revise]
---

## Rule

Use **two-space indent + `- `** for sub-bullets. Blank lines between sub-bullets AND between parent and first sub-bullet.

**NEVER type `--` as a sub-bullet marker** — in Typst, `--` renders as an en-dash character, not a list item. The template already sets `#set list(marker: ([•], [--]))` which automatically renders nested items with an en-dash marker.

```typst
// CORRECT: blank lines between parent and sub-bullets, and between sub-bullets
- Two market imperfections undermine this:

  - *Free riding* --- investors fail to distinguish among reputations

  - *Agency problems* --- individuals may sacrifice the firm's reputation
```

```typst
// WRONG: no blank lines (renders tightly packed)
- Two market imperfections undermine this:
  - *Free riding* --- investors fail to distinguish
  - *Agency problems* --- individuals may sacrifice
```

```typst
// WRONG: -- is an en-dash, not a bullet
- Two imperfections:
  -- *Free riding*
  -- *Agency problems*
```
