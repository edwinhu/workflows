# PLAN

Only after CLARIFY may you inspect the task. Gather enough evidence to choose an approach, then use
native Plan mode and obtain approval through `ExitPlanMode`. Approval is the last cheap opportunity to
change direction.

The resulting safe generated `.planning/<native-name>.md` is bound by `.planning/.state/review.json`.
The receipt-selected plan is the sole specification; never copy it into another planning document. Keep
it proportional. If it grows beyond roughly ten steps, needs real sub-phases, or wants a domain-specific
specification, stop and route to the appropriate workflow.

## Required work PLAN schema

Every work plan contains these exact top-level sections exactly once:

```markdown
## Intent

## Exclusions

## Success Criteria

## Implementation Plan

## Evidence Plan

## Review Surfaces
```

- **Intent** states the desired outcome and material constraints.
- **Exclusions** names what this episode will not change or decide.
- **Success Criteria** gives each criterion a stable identifier and observable outcome.
- **Implementation Plan** gives every actionable task a stable task ID and complete runner fields:
  task name, concrete work, criteria, outputs, writable paths, dependencies, required instruction files,
  model, and effort. Dependencies use stable task IDs, not prose ordering.
- **Evidence Plan** maps every criterion and task to executable evidence or an explicitly human judgment.
- **Review Surfaces** names each diff, rendered artifact, output, or decision the user must inspect.

Missing task authority is a planning failure. Do not infer outputs, writable paths, or criteria later to
make a task dispatchable.

## Whole-plan review boundary

After approval, require one independent whole-plan review. The reviewer checks every section together,
binds the verdict to the exact receipt-selected `plan_file` and `plan_hash`, and persists the combined
receipt in `.planning/.state/review.json`. Implementation waits for `APPROVED`, strict
approval-before-review chronology, and a reviewer session distinct from approval and implementation.

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
3. state that the workflow owns only that closed stage while `/work` retains `/goal`, independent
   verification, and human review.

A Workflow cannot own a conversational loop or decide creative treatment independently per item.

## Red flags

| About to | Do instead |
|---|---|
| Let the plan become a fifteen-step mini-project | Escalate to `/dev`, `/ds`, `/writing`, or another specialized workflow |
| Leave task outputs or writable paths for implementation to guess | Complete the task row before approval |
| Patch the receipt-selected generated plan | Replace it through native Plan mode and fresh review |
| Hand-edit parallel copies from one pinned treatment | Offer a closed drift-proofed fan-out stage |
| Put `/goal`, verifier continuity, or human review inside a Workflow | Keep those in the conversational `/work` adapter |
