---
name: phase-summary-frontmatter
description: Every completed phase appends a structured YAML summary to PHASE_SUMMARY.md
applies-to: [writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

When completing any phase, produce a structured summary in `.planning/PHASE_SUMMARY.md` (append, don't overwrite):

```yaml
---
phase: [phase-name]
status: completed
sections_affected: [list of section names]
artifacts_produced: [list of files created/modified]
requires: [artifacts this phase consumed]
provides: [artifacts this phase produced]
deviations: {r1: 0, r2: 0, r3: 0, r4: 0}
---

One-liner: [SUBSTANTIVE summary -- not "Phase complete" but "Outlined 4 sections mapping 3 PRECIS claims with transition bridges planned"]

## Key Decisions
- [decisions made during this phase]

## Issues Encountered
- [blockers, deviations, or surprises]
```

**Required fields:** `phase`, `status`, `artifacts_produced`, `provides`. One-liner must be substantive.

## Rationale

**Why this exists** -- without structured summaries, handoff and resume require re-reading all changed files. With frontmatter, the next session can reconstruct what happened from `provides`/`artifacts_produced` fields alone. This was critical after context exhaustion incidents where sessions died mid-workflow and the resuming session had no way to know what had been completed without reading every file.

## Examples

### Correct

```yaml
---
phase: outline
status: completed
sections_affected: [Part I, Part II, Part III, Conclusion]
artifacts_produced: [.planning/OUTLINE.md, outlines/Part I.md, outlines/Part II.md, outlines/Part III.md, outlines/Conclusion.md]
requires: [.planning/PRECIS.md]
provides: [.planning/OUTLINE.md, outlines/Part I.md, outlines/Part II.md, outlines/Part III.md, outlines/Conclusion.md]
deviations: {r1: 0, r2: 0, r3: 1, r4: 0}
---

One-liner: Outlined 4 sections mapping 3 PRECIS claims with transition bridges; R3 deviation added sub-section in Part II for missing evidence gap.

## Key Decisions
- Part II split into two sub-sections to accommodate CLAIM-02 evidence
- Conclusion structured as policy recommendation rather than summary

## Issues Encountered
- R3: Missing evidence for CLAIM-02 required structural adjustment in Part II
```

### Incorrect

```yaml
---
phase: outline
status: completed
---

One-liner: Phase complete.
```

(Missing required fields. Non-substantive one-liner. No decisions or issues. Useless for handoff.)

## Summary Facts

- The summary is step 6 of the phase gate function — written at gate time, not "later": context compression erases the details, and simple phases still produce artifacts the next phase consumes.
- Zero deviations is information — `{r1: 0, r2: 0, r3: 0, r4: 0}` confirms the plan held; record it explicitly.
- The next session reconstructs state from `provides`/`artifacts_produced` alone. A "Phase complete" one-liner forces it to re-read every file — the exact failure (post-context-exhaustion resume) this constraint exists to prevent.

## Red Flags

- **One-liner says "Phase complete" or "Done"** -- STOP. That's not substantive. Describe what was produced and what changed.
- **Missing `artifacts_produced` or `provides`** -- STOP. These are the fields that make handoff work. Fill them in.
- **Skipping the summary entirely** -- STOP. SUMMARY is step 6 of the gate function. It's not optional.
- **Overwriting PHASE_SUMMARY.md instead of appending** -- STOP. Previous phase summaries are needed for full workflow history.
