---
name: dev-debug
version: 5.0
description: "Systematic debugging of a specific failure inside the authenticated /dev lifecycle."
---

# Dev debugging

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-debug`

Use debugging to investigate a named failure, not to re-authorize implementation. When invoked during
`/dev`, resolve the receipt-selected `{planFile, planHash}` and create/reconcile TaskList investigation
and repair items. Do not create `HYPOTHESES.md`, `LEARNINGS.md`, `HANDOFF.md`, `STATE.md`, a fixed
plan, or any visible planning ledger.

## Fresh investigation loop

1. Capture the symptom, reproduction command, current plan identity, and scope in one TaskList
   investigation item.
2. Dispatch one fresh investigator at a time. The investigator reproduces the failure, tests one
   hypothesis, and returns evidence, changed files, a specific regression-test result, and the next
   hypothesis. Keep investigation conclusions in the TaskList item and returned result.
3. A confirmed fix requires a new failing regression test (RED), minimal repair, GREEN, and a fresh
   full relevant suite. The doer never self-verifies.
4. Convert an actionable confirmed repair into a current-plan TaskList work item and route it through
   `dev-implement`; then independently verify it. If the diagnosis changes requirements or approved
   architecture, stop and return to native clarification/planning for a new receipt.
5. Stop and escalate on repeated non-progress, missing reproduction, or a blocker requiring user input.

## Return contract

```text
Dev debug result
- Plan: {planFile, planHash}
- Investigation: TaskList ID
- Reproduction and hypotheses: [{hypothesis, result, evidence}]
- Repair: TaskList ID | none
- Regression evidence: {red, green, suite}
- Status: FIXED | BLOCKED | ESCALATE
```

A returned `FIXED` is only an implementation report until the independent verifier records PASS.
