---
name: ds-review
description: "Phase 5 of the /ds workflow — human review of an analysis after technical verification. Invoked by the workflow; not user-invocable."
user-invocable: false
disable-model-invocation: true
---

# DS human review

This is the human acceptance beat. It does not perform technical, methodological, or peer review; those
belong to the VERIFY operation inside `ds-implement`.

Read `${CLAUDE_SKILL_DIR}/../../skills/beat-review/SKILL.md` and follow it. It owns human-feedback
capture, the task queue, dispositions, and the meaning of `REJECT:`.

## Prepare the review

1. Read `.planning/PLAN.md` and copy its **Review Surfaces** into `.planning/REVIEW.md`. The copied
   surfaces are the review contract for this analysis: they say what result, table, figure, decision, or
   other output the user should inspect. Do not substitute a fixed DS checklist; the plan author chooses
   surfaces that fit this analysis.
2. Add a human-review ledger beneath the copied surfaces. It records each annotation or chat item, its
   disposition (`addressed`, `answered`, or user-authorized `waived`), and the resulting action or answer.
3. Present the actual review surfaces and their outputs to the user. Ask for acceptance, tactical
   feedback, or `REJECT:`. A clean technical verification is evidence for this conversation, not human
   acceptance.

Use this minimum structure:

```markdown
# Human Review

## Review Surfaces
[Copied verbatim from PLAN.md]

## Feedback Ledger
| Item | Channel | Disposition | Action / answer |
|------|---------|-------------|-----------------|

## Outcome
PENDING | ACCEPTED | CHANGES_REQUIRED | REJECTED
```

## Route the outcome

- **ACCEPTED:** record the user's acceptance in `REVIEW.md`. The acceptance beat is complete.
- **Tactical feedback:** capture and disposition every item through `beat-review`. Send unresolved
  changes to `ds-implement` with the concrete ledger rows; its verifier loop must re-run before this
  human review resumes. Do not treat an implementer's claim as a new acceptance.
- **`REJECT:`** is not tactical feedback. The deliverable passed technical verification and the user still
  rejected it, so the plan's criteria were wrong. Mark the plan, implementation, and review invalidated;
  clear their prior approval/completion claims; return to `ds` to clarify and replace the plan. Do not
  patch the existing analysis, append criteria to the rejected plan, or route this to `ds-implement`.

## Gate

Before reporting acceptance, confirm that `REVIEW.md` contains the copied Review Surfaces, every feedback
item has a disposition, and there is no outstanding `REJECT:`. Then proceed immediately according to the
outcome above.
