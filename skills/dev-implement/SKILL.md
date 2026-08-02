---
name: dev-implement
description: "Internal /dev execution adapter for authenticated generated plans."
user-invocable: false
disable-model-invocation: true
hooks:
  PostToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/work-implement-observation.ts --phase post"
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/work-implement-observation.ts --phase pre"
    - matcher: "Write|Edit|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow dev"
    - matcher: "Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow dev"
---

# Dev implementation

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts dev-implement`

`/dev` is an adapter over the shared IMPLEMENT beat. Its sole planning authority is the exact,
receipt-selected generated `{planFile, planHash}`. Never read, mutate, compile, or resume a fixed
`PLAN.md`; do not create `run.js`, `progress.md`, `STATE.md`, `SPEC.md`, or `LEARNINGS.md`.

## Admission and reconciliation

1. Resolve the current authenticated dev receipt in `.planning/.state/review.json`; require exact
   `{planFile, planHash}` and reject missing, stale, mismatched, or pending identity.
2. Parse the receipt-selected plan only to construct its complete implementation task contracts.
   Each task must retain its stable `plan_task_id`, dependencies, work, criteria, outputs,
   `writablePaths`, first failing test, verify command, instruction files, model, and effort.
3. Reconcile TaskList using `(planHash, plan_task_id, item_kind)` identity:
   - reuse one unique same-hash item;
   - fail closed on duplicate live matches;
   - create only missing work items and dependencies among current-hash implementation items;
   - preserve attempted work on plan replacement as `superseded` with `superseded_by_plan_hash`;
     delete only untouched, finding-free work.
4. Build a complete ready wave from dependency-satisfied current-hash work, in stable plan order.
   The runner does not discover or parse plans.

## IMPLEMENT = GOAL + WORK + independent VERIFY

Load and follow `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`. Keep one bounded `/goal` tied to
`{planFile, planHash}`. Only the top-level session may activate or clear it:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal <condition>"
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"
```

Proceed only after `status: delivered` or the user explicitly confirms the goal is active; otherwise
print the literal command and stop. Invoke the shared runner with the complete ready wave and exact identity:

Load and follow `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`; it owns dispatch. Route the wave by
shape first, then dispatch what the route says — one task goes to a single subagent, a fan-out is
compiled into a generated workflow under `.claude/workflows/`.

```bash
echo "$READY_WAVE_JSON" | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/route-implementation.ts
# route == "workflow" -> generate the plan-bound script, then run it
echo '{"projectDir":"<absolute project path>",planFile: "<receipt plan_file>", planHash: "<receipt plan_hash>",
       "domain":"dev","phases":[...],"tasks":[...]}' \
  | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/emit-implementation-workflow.ts
```

```js
Workflow({ scriptPath: "<path returned by the generator>", args: {} })
```

The domain supplies `phases` and each task's `prompt`; `planFile` and `planHash` come from the
receipt-selected plan and bind the generated script to it. There is no checked-in runner script to
invoke — the script is generated per plan, and a new plan hash produces a new script.

The runner dispatches mutations sequentially. Do not hand-dispatch an alternative compiler runner.
For a retry, send only previously attempted task IDs and their returned attempt records.

## TDD contract

Every task's `work` and `criteria` require: write and run the named test against missing behavior;
observe and report a valid RED; only then implement; run the exact verify command to GREEN; report
changed files and raw evidence. A doer never verifies its own task. An independent fresh verifier
checks each criterion and named evidence after the runner returns. On failure, create or update the
corresponding TaskList finding/retry dependency and resume only affected attempted work.

## Transition

After all current-hash implementation items independently pass, run `dev-test-gaps`. Its returned
requirement-to-test matrix, not a visible validation ledger, is the quality-gate result. Clear the
goal after terminal verification PASS, then continue to `dev-review`.

## Red flags — STOP

- About to trust a task report as verification: run the fresh verifier.
- About to mark a plan checkbox or append a progress ledger: update TaskList instead.
- About to change requirements, architecture, dependencies, test contract, or evidence: return to
  native planning for a new generated plan and receipt rollover.
- About to use an old fixed plan or legacy artifact: it is conversion-only provenance, never live
  authority.
