# PLAN

Only after CLARIFY may you inspect the task. Gather enough evidence to choose an approach, then use
native Plan mode and obtain approval through `ExitPlanMode`. Approval is the last cheap opportunity to
change direction.

Keep the plan proportional: a handful of ordered steps, each naming the target and its completion
evidence. If it grows beyond roughly ten steps, needs real sub-phases, or wants a domain specification,
stop and route to the appropriate specialized workflow. A lightweight workflow stretched past its
ceiling provides ceremony without the guarantees the larger workflow exists to supply.

After approval, copy the approved plan verbatim into `WORK.md`'s `## Plan` section and set
`status: planned`. `/work` does not use DS's immutable approved-plan persistence hook.

## Fan-out check

Before approval, ask whether the plan applies the same pinned treatment to independent items. It
qualifies for a dynamic Workflow only when the per-item “what” is already decided and the stage buys a
specific advantage: parallelism, context isolation, or drift-proofing.

If it qualifies, include one explicit offer at the plan-approval gate:

1. name the item set and treatment;
2. name the concrete advantage;
3. state the division of labor: the workflow owns only the closed fan-out stage and returns results;
   `/work` retains `/goal`, independent verification, and human review.

A Workflow cannot take mid-run user input, so it cannot own the conversational loop. Creative work
whose central choice differs per item is not a mechanical fan-out. If the user declines, proceed inline.

## Red flags

| About to | Do instead |
|---|---|
| Let the plan become a fifteen-step mini-project | Escalate to `/dev`, `/ds`, `/writing`, or another specialized workflow |
| Hand-edit parallel copies from one pinned treatment | Offer a drift-proofed fan-out stage |
| Put `/goal`, verifier continuity, or human review inside a Workflow | Keep those in the conversational `/work` adapter |
