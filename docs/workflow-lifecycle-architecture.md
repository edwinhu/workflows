# Workflow lifecycle architecture

The lifecycle layer separates shared enforcement mechanics from workflow-specific planning and
execution adapters. All six built-ins — dev, DS, work, writing, workshop, and workflow-creator —
use a hook-authenticated receipt selecting one native generated plan by `{planFile, planHash}`.
`/work` remains proportional in its planning depth, not in its authority model.

## Authority model

```text
.planning/<generated-name>.md       immutable approved intent
.planning/.state/review.json        hook-owned approval and independent-review provenance
TaskList                            live tasks, dependencies, retries, and findings
project auto-memory                 reusable discoveries
normal project paths                implementation, deliverables, and runtime evidence
```

The receipt is not a progress ledger. It binds the exact bytes returned by native `ExitPlanMode`;
a changed requirement, architecture, dependency, test contract, or evidence plan requires a new
generated plan and receipt rollover. `TaskList`, not checkboxes or visible planning files, is the
live execution authority. Returned phase results carry conversational findings and human-review
outcomes; implementation evidence stays with the actual project output.

## Shared lifecycle mechanics

| Concern | Shared behavior |
|---|---|
| Opening clarification | `clarify-before-recon-guard --workflow <built-in>` accepts only a current-session, two-field clarification sentinel; it stores no requirements. |
| Approval persistence | `approved-artifact.ts` hashes the exact native generated plan and atomically creates the hidden `PENDING` receipt. |
| Independent review | `plan-checker` receives the exact generated path, rehashes before review and finalization, and `reviewer-verdict-guard` permits only receipt finalization. |
| Implementation admission | `approved-artifact-gate` requires the current plan hash, strict chronology, and separate approval/review/implementation sessions. |
| Mutation boundary | `orchestrator-mutation-guard` permits only native generated-plan leaves, narrow hook-owned `.state` transitions, recognized clarification sentinels, and declared machine state. |
| Task interchange | `TaskContract` and `TaskList` give runners durable task identity without interpreting mutable plan copies. |

`hooks/_workflow_policies.ts` supplies only workflow policy: sentinel name, reconnaissance
classification, reviewer artifact, and mutation allowances. Shared libraries own containment,
symlink rejection, SHA-256, UTC timestamps, strict receipt parsing, chronology, and race checks.
External descriptor schema v1 remains an isolated compatibility contract; it does not change the
built-in receipt model.

## Dev adapter

Dev preserves question-first engineering rigor within the shared authority model:

```text
opening clarification → read-only reconnaissance → post-recon clarification
→ explicit architecture choice → native Plan mode → exact-path independent review
→ TaskList/beat-implement → fresh verification → terminal human acceptance
```

Its generated plan has stable `REQ-NN` requirements and `TASK-NN` execution blocks with an
explicit real-test contract, RED expectation, exact verify command, outputs, writable paths,
evidence plan, and review surfaces. The `beat-implement` adapter reconciles the receipt-selected
plan into TaskList. Requirement coverage, test gaps, reviewer findings, retries, and handoff
status are TaskList items and returned results, never fixed `SPEC.md`, `PLAN.md`, compiler output,
or visible phase ledgers.

## Other execution adapters

DS and workflow-creator use the shared sequential `beat-implement` runner. Writing and workshop
authenticate the same approved-plan identity while retaining controlled parallel generators:

```text
writing approved plan  → writing-draft section workflow → internal writing-verify → /writing-revise
workshop approved plan → workshop-generate sections     → workshop-verify       → /workshop-revise
workflow-creator plan  → TypeScript manifest compiler   → beat-implement        → workflow-creator-verify → /workflow-creator-improve
```

Domain generators do not select plans: deterministic section/slide indexes provide their work
sets. Automated review remains distinct from terminal human acceptance; human feedback is retained
in the applicable review surface and live TaskList findings rather than a second plan authority.
