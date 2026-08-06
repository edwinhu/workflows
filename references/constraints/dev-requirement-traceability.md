---
name: dev-requirement-traceability
description: REQ-NN IDs in the native dev plan must trace through TaskList work, tests, and fresh evidence
applies-to: [dev-design, dev-plan-reviewer, dev-implement, dev-verify, dev-accept, dev-test-gaps]
---

# Dev requirement traceability

The exact approved native dev plan is the only requirement authority. `## Requirements` assigns a
stable `REQ-NN` ID to every in-scope behavioral requirement, and its `## Requirement → Test Map`
maps each ID to `TASK-NN` work, named tests, and concrete evidence commands.

| Authority | Traceability role |
|---|---|
| Native generated plan | Defines each `REQ-NN`, `TASK-NN`, real-test contract, and evidence plan. |
| TaskList | Holds live task identities, dependencies, retries, test-gap findings, review findings, and supersession state for the current plan hash. |
| Test/runtime evidence | Establishes whether each requirement's named behavior actually works. |
| Returned verification/review result | Reports the final requirement-to-test matrix and unresolved blockers; it is not a new plan ledger. |

A requirement with no task, test, or evidence is a structural plan gap. A behavioral statement
outside the requirements map is a missing requirement, not an optional note. Do not add new
requirements mid-implementation: return to native Plan mode, create a replacement generated plan,
and obtain a fresh receipt.

## Red flags

- **A requirement has no `REQ-NN` ID** — STOP. Put it in the native generated plan before review.
- **A `REQ-NN` lacks a `TASK-NN`, test, or evidence command** — STOP. Replan and reapprove.
- **A task is tracked outside TaskList or mutable plan checkboxes** — STOP. Reconcile the current
  receipt-selected plan into TaskList.
- **A reviewer claims coverage without fresh runtime evidence** — STOP. Run the map's concrete
  commands and record the result through TaskList/returned evidence.
- **An implementation discovery changes requirement scope** — STOP. It needs a new generated plan,
  not an edit to approved bytes.
