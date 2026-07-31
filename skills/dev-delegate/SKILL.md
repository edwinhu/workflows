---
name: dev-delegate
description: "Internal /dev task-dispatch contract for the shared implementation runner."
user-invocable: false
disable-model-invocation: true
---

# Dev delegation

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-delegate`

`dev-delegate` supplies task-local instructions to the shared `beat-implement` runner; it is not a
second execution engine. The only planning authority is the authenticated receipt-selected
`{planFile, planHash}` plus the reconciled TaskList task identity. Never create task briefs, a fixed
plan copy, progress ledger, state file, or review artifact.

For each dispatched task include its stable `plan_task_id`, TaskList ID, exact plan identity, approved
work and criteria, outputs/writable paths, instruction files, model, effort, and verify command.

## Doer contract

1. Read only the supplied immutable task specification and permitted project files.
2. Write the intended behavioral test and run it before implementation; report the observed RED.
3. Implement only after RED, then run the exact verify command to GREEN.
4. Report changed files, commands, raw RED/GREEN evidence, blockers, and reusable-fact candidates.
5. Never declare the task verified or create/update a planning ledger. The independent verifier owns
   PASS/FAIL.

A changed requirement, architecture, dependency, test contract, or evidence contract is an escalation
for a replacement generated plan, not a local patch. The runner dispatches mutations sequentially;
subagents never delegate further implementation work.
