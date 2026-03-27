---
name: typst-label-bullet-spacing
description: Bold label lines must have a blank line before the following bullet list — Typst renders inline without it
applies-to: [workshop, workshop-revise]
---

<EXTREMELY-IMPORTANT>
## Rule

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
</EXTREMELY-IMPORTANT>
