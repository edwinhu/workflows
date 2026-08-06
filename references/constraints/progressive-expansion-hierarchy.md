---
name: progressive-expansion-hierarchy
description: Writing proceeds through 4 levels of detail — never skip levels
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-verify, writing-revise, writing-precis-reviewer, writing-outline-reviewer]
---

## Rule

Writing proceeds through levels of detail. Each level expands the previous. **Never skip levels.**

```
.planning/PRECIS.md          # Level 1: Thesis, claims, audience
       ↓
.planning/OUTLINE.md         # Level 2: Master structure (sections, goals)
       ↓
outlines/Part I.md         # Level 3: Detailed section outline (bullets, sources)
       ↓
drafts/Part I.md           # Level 4: Prose expansion
```

| Iron Law | Means |
|----------|-------|
| NO OUTLINE WITHOUT PRECIS | PRECIS.md must exist before OUTLINE.md creation |
| NO DRAFT WITHOUT OUTLINE | Every section in drafts/ must have a matching outlines/ file |
| NO REVISION WITHOUT REVIEW.md | writing-revise refuses to proceed without structured review diagnosis |

## Rationale

**Why this exists** — each level provides the structural scaffolding for the next. Skipping levels produces drafts that lack coherent structure, outlines that don't serve a thesis, or revisions that fix symptoms without understanding the review diagnosis. The hierarchy enforces that every artifact is grounded in the artifact above it.

## Examples

### Correct
1. User invokes /writing. PRECIS.md is created and reviewed.
2. OUTLINE.md is created from PRECIS.md and reviewed.
3. Each section outline in `outlines/` is created from OUTLINE.md.
4. Each draft in `drafts/` expands its matching outline.

### Incorrect
1. User invokes /writing. Agent jumps straight to drafting prose without creating PRECIS.md or OUTLINE.md.
2. Agent creates OUTLINE.md without a PRECIS.md — the outline has no thesis to serve.
3. Agent begins revising a draft without REVIEW.md — fixes are unstructured guesses.

## Hierarchy Facts

- An outline held "in my head while drafting" is invisible, unverifiable, and erased by context compression — only the written file survives to ground the next level.
- Short pieces make the levels brief; they never skip them — a thesis → structure → prose chain exists at every length.

## Red Flags

- **"Let me just start drafting"** → STOP. Does PRECIS.md exist? Does OUTLINE.md exist? Does an outline file exist for this section?
- **"We don't need a precis for this"** → STOP. Every piece needs a thesis and claims, even short ones.
- **"I can revise without a formal review"** → STOP. NO REVISION WITHOUT REVIEW.md. Invoke /writing-verify first.
- **"The outline is implied by the precis"** → STOP. Implied is not written. Write OUTLINE.md.
