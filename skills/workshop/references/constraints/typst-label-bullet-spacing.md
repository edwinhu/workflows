---
name: typst-label-bullet-spacing
description: Bold label lines must have a blank line before the following bullet list — Typst renders the bullet inline without it
type: constraint
testable: true
check-script: label-bullet-spacing.py
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, lecture-prep-edit]
---

<EXTREMELY-IMPORTANT>
## Rule — The Iron Law of Label-Bullet Spacing

**A BOLD LABEL LINE (`*Label:*`) MUST HAVE A BLANK LINE BEFORE THE FOLLOWING BULLET LIST. This is not negotiable.**

Typst treats a bullet immediately after a paragraph line as a continuation of the paragraph, not as a separate list. This renders the bullet inline with the label text instead of as a proper indented list item.

```typst
// WRONG: bullet renders inline with label
*Key requirements:*
- Must file within 10 days

// CORRECT: blank line separates paragraph from list
*Key requirements:*

- Must file within 10 days
```

**Bad pattern:**
```typst
*Graphic communication:*
- Includes all forms of electronic media
```

**Fix — add a blank line:**
```typst
*Graphic communication:*

- Includes all forms of electronic media
```

**Applies to:** workshop, workshop-revise, lecture-prep (SLIDES phase), slides-edit, lecture-prep-edit
</EXTREMELY-IMPORTANT>
