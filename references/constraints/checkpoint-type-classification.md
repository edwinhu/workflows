---
name: checkpoint-type-classification
description: Gate types determine whether phases auto-advance or pause for human input
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-verify, writing-revise]
---

## Rule

Gates in the writing workflow fall into three types. Autonomous mode can auto-advance `human-verify` gates but must pause at `decision` and `human-action` gates.

| Gate | Phase Transition | Type | Notes |
|------|-----------------|------|-------|
| PRECIS reviewer approval | Setup -> Outline | `human-verify` | Agent reviewer decides; auto-advanceable |
| Outline reviewer approval | Outline -> Draft | `human-verify` | Agent reviewer decides; auto-advanceable |
| Domain/style selection | Entry routing | `decision` | User chooses legal/econ/general |
| Review strategy selection | Review start | `decision` | User chooses sequential vs parallel |
| VALIDATION.md gap decisions | Validate -> Review | `decision` | User decides fix vs accept vs restructure for gaps |
| Draft gate (all sections exist) | Draft -> Validate | `human-verify` | File existence check; auto-advanceable |
| Review gate (3 levels complete) | Review -> Revise | `human-verify` | Artifact completeness check; auto-advanceable |
| Iteration escalation (3+ cycles) | Revise loop | `decision` | User chooses next step when stuck |
| Completion verdict | Revise -> Done | `human-verify` | Zero issues in re-review; auto-advanceable |

**Most gates are `human-verify` -- the workflow can run autonomously through them.** Only domain selection, review strategy, gap decisions, and escalation require genuine human input.

**Phase skills MUST check this table at each gate.** If the gate type is `human-verify`, auto-advance without pausing. If `decision`, present options and wait. This is how the workflow runs autonomously through 6 of 9 gates while pausing only for genuine choices.

## Rationale

**Why this exists** -- without checkpoint classification, the workflow pauses at every gate to ask "should I continue?" This turns a 6-phase autonomous workflow into a 9-pause interactive session. The user invoked /writing for structured autonomous execution, not for hand-holding at every transition. Conversely, auto-advancing through genuine decision points (like domain selection) removes user agency on choices that affect output quality.

## Examples

### Correct

```
# After outline reviewer returns APPROVED:
Gate type: human-verify -> auto-advancing to Draft phase.
Loading writing-draft skill...

# After validation reveals gaps:
Gate type: decision -> presenting options to user.
VALIDATION.md found 2 gaps:
  - CLAIM-02: PARTIAL coverage in Part II
  - CLAIM-04: MISSING from all sections
Options: (a) fix gaps in revision, (b) accept partial coverage, (c) restructure outline
```

### Incorrect

```
# After outline reviewer returns APPROVED:
"The outline has been approved! Shall I proceed to drafting?"
(human-verify gate. Don't ask. Auto-advance.)

# After validation reveals gaps:
"I'll go ahead and fix the gaps automatically."
(decision gate. Don't auto-advance. Present options.)
```

## Gate Facts

- The table, not your judgment, defines where the user decides. Asking "just to be safe" at a human-verify gate wastes the user's time; auto-advancing a decision gate because "the choice seems obvious" removes their agency on a choice that affects output quality. Both directions of override are unhelpful.
- Decision gates are presented separately, never combined into one question — each has distinct options, and combining loses clarity. (Smart Discuss batching applies to intra-phase ambiguities, not to decision gates.)

## Red Flags

- **Asking "should I continue?" at a human-verify gate** -- STOP. Check the table. Auto-advance.
- **Auto-advancing through a decision gate** -- STOP. The user needs to choose. Present options.
- **Not checking the table at a gate** -- STOP. Every gate has a type. Look it up before acting.
- **Treating all gates the same** -- STOP. The three types exist for a reason. Differentiate.
