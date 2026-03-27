---
name: typst-source-first
description: Never fill content gaps from training knowledge — extract from the source paper first
applies-to: [workshop, workshop-revise]
---

<EXTREMELY-IMPORTANT>
## The Iron Law of Source-First Content

**NEVER FILL CONTENT GAPS FROM TRAINING KNOWLEDGE. This is not negotiable.**

When writing or fixing slide/notes content, extract from the source paper and `.planning/SOURCES.md` FIRST. Then write. Training knowledge fabricates case facts, misattributes findings, and invents statistics. Every claim in the slides must trace to a specific page or section of the paper.

**Do NOT:**
- Write case facts, empirical results, or statutory language from memory
- "Fill in" gaps when the paper doesn't cover something — flag it to the user instead
- Paraphrase findings without verifying against the source
- Attribute claims to authors without checking the paper

**Do:**
- Extract content from the paper PDF (via look-at or rga)
- Cite specific page numbers or section references
- Flag to the user when content cannot be found in the source
- Use `.planning/SOURCES.md` metadata as the starting point

**If you cannot find content in the source paper, it does not go in the slides.**
</EXTREMELY-IMPORTANT>

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I know this paper from training — I'll write the findings" | Training knowledge fabricates results and misattributes findings | Extract from the paper. Every claim needs a source. |
| "The gap is small — I'll fill it from what I know" | Small fabrications are harder to catch than large ones | Flag the gap to the user |

## Red Flags

- **Writing empirical results without extracting from the paper** — STOP. Extract first.
- **Adding claims not found in the source** — STOP. Flag to the user.
- **"I'm confident this is correct from training"** — STOP. Confidence ≠ accuracy.
