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

1. Resolve the exact receipt-selected native generated plan from its authenticated `{planFile, planHash}`
   identity. Read its **Review Surfaces**; they define the outputs the user should inspect. Do not
   substitute a fixed DS checklist.
2. Present those actual review surfaces and outputs to the user. Ask for acceptance, tactical feedback, or
   `REJECT:`. A clean technical verification is evidence for this conversation, not human acceptance.
3. Return each feedback item, disposition (`addressed`, `answered`, or user-authorized `waived`), and the
   resulting action or answer through the review result and corresponding TaskList context. Do not create
   a planning Markdown ledger for review material.

## Route the outcome

- **ACCEPTED:** record the user's acceptance in the returned result and TaskList. The acceptance beat is
  complete.
- **Tactical feedback:** capture and disposition every item through `beat-review`. Send unresolved changes
  to `ds-implement` with the concrete returned items; its verifier loop must re-run before this human
  review resumes. Do not treat an implementer's claim as a new acceptance.
- **`REJECT:`** is not tactical feedback. The deliverable passed technical verification and the user still
  rejected it, so the receipt-selected plan's criteria were wrong. Mark the implementation and review
  invalidated in TaskList; return to `ds` to clarify and bind a replacement receipt-selected native
  generated plan. Do not patch the rejected generated plan, append criteria to it, or route this to
  `ds-implement`.

## Gate

Before reporting acceptance, confirm that every feedback item has a disposition in the returned result and
TaskList context and that there is no outstanding `REJECT:`. Then proceed immediately according to the
outcome above.
