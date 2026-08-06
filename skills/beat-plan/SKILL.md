---
name: beat-plan
description: "Shared PLAN primitive — bind clarified intent to one approved receipt-selected generated plan and hold it immutable through independent whole-plan review."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — PLAN

`plan = native approval + receipt + independent whole-plan review`

The beat between CLARIFY and IMPLEMENT. Only after CLARIFY may you inspect the task. Gather enough
evidence to choose an approach, then use native Plan mode and obtain approval through `ExitPlanMode`.
Approval is the last cheap opportunity to change direction.

**The caller supplies:** its workflow identity, the exact plan grammar its domain requires, and its own
proportionality ceiling. Everything below is the same in every workflow.

## Receipt binding

The resulting safe generated `.planning/<native-name>.md` is bound by `.planning/.state/review.json`,
which records the exact `plan_file`, `plan_hash`, workflow identity, native approval session and time,
and independent review session and time. Use the exposed `planFile` and `planHash` unchanged.

The receipt-selected plan is the sole substantive specification. Never copy it into another planning
document: a copy is competing authority, and the copy is the one that drifts.

## The plan grammar is declared, not discovered

Each workflow declares the exact top-level sections its plans contain, each exactly once. A plan that
does not satisfy its declared grammar is a **planning failure**, not something to patch during
implementation. Missing task authority — outputs, writable paths, criteria, dependencies — is the
common shape: inferring it later to make a task dispatchable silently substitutes the implementer's
judgment for the approval the receipt claims to carry.

## Whole-plan review boundary

After approval, require one independent whole-plan review. The reviewer checks every section together,
binds the verdict to the exact receipt-selected `plan_file` and `plan_hash`, and persists the combined
receipt in `.planning/.state/review.json`. Implementation waits for `APPROVED`, strict
approval-before-review chronology, and a reviewer session distinct from approval and implementation.
Sections reviewed piecemeal pass individually and contradict each other in aggregate.

Changing intent, criteria, task authority, dependencies, evidence, or review surfaces replaces the plan,
invalidates prior review, and requires fresh approval plus whole-plan review. The receipt-selected
generated plan is never patched in place.

## Fan-out check

Before approval, ask whether the plan applies the same pinned treatment to independent items. It
qualifies for a dynamic Workflow only when each item's “what” is already decided and the stage buys a
specific advantage: isolation, parallelism with real filesystem isolation, or drift-proofing.

If it qualifies, include one explicit offer at the plan-approval gate:

1. name the item set and treatment;
2. name the concrete advantage;
3. state that the workflow owns only that closed stage while the caller retains `/goal`, independent
   verification, and human review.

A Workflow cannot own a conversational loop or decide creative treatment independently per item.

## Gate

The receipt-selected `planFile` and `planHash` form an approved artifact for the caller's workflow
identity, satisfying the declared grammar, with an `APPROVED` whole-plan review recorded in a session
distinct from approval.

## Red flags

| About to | Do instead |
|---|---|
| Leave task outputs or writable paths for implementation to guess | Complete the task row before approval |
| Patch the receipt-selected generated plan | Replace it through native Plan mode and fresh review |
| Review sections one at a time | Require one reviewer over the whole plan |
| Reuse a review bound to a different `plan_hash` | Obtain a fresh whole-plan review |
| Approve and review in the same session | Separate the approval, review, and implementation sessions |
| Hand-edit parallel copies from one pinned treatment | Offer a closed drift-proofed fan-out stage |
| Put `/goal`, verifier continuity, or human review inside a Workflow | Keep those in the caller's conversational adapter |
