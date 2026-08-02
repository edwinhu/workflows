---
name: dev-implement
description: "Internal /dev execution adapter for authenticated generated plans."
user-invocable: false
disable-model-invocation: true
hooks:
  PostToolUse:
  PreToolUse:
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
# ONE call. The preflight authenticates the approval, validates every task against the shared
# contract, canonicalises writable paths, binds a per-task approval, DERIVES THE ADJUDICATION
# EXPECTATION the observation hooks read, routes by shape, and emits the script when one is warranted.
echo "$PREFLIGHT_REQUEST_JSON" | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/preflight.ts
```

`PREFLIGHT_REQUEST_JSON` is `{"projectDir": "<absolute project path>", "workflow": "dev",
"planReset": {"planFile": "<receipt plan_file>", "planHash": "<receipt plan_hash>"},
"phases": [...], "readyWave": [...]}`.

**Do NOT call `route-implementation.ts` or `emit-implementation-workflow.ts` yourself.** They are the
preflight's internals. Calling them directly skips the approval authentication and — the silent part —
skips the expectation file, so every dispatch is adjudicated against no bounds at all and the run
looks clean because nothing was ever checked. `scripts/beat/implement-gate.ts` then refuses the wave
with reason `no-expectation`, whose remedy reads "the preflight never ran".

```js
Workflow({ scriptPath: "<path returned by the generator>", args: {} })
```

The domain supplies `phases` and each task's `prompt`; `planFile` and `planHash` come from the
receipt-selected plan and bind the generated script to it. There is no checked-in runner script to
invoke — the script is generated per plan, and a new plan hash produces a new script.

The runner dispatches mutations sequentially. Do not hand-dispatch an alternative compiler runner.
For a retry, send only previously attempted task IDs and their returned attempt records.

## TDD contract

**Every dev task MUST declare `redCommand`** — the exact command that fails before the task is
implemented and passes after. The preflight refuses a dev wave without one, and it is bound into the
wave fingerprint, so it cannot be swapped after approval.

It is not evidence you report. The observation hook EXECUTES it on both sides of the dispatch and
records the exit codes; `implement-gate` then requires nonzero before and zero after. Three ways a
task fails on it, each named distinctly:

| Verdict | Meaning |
|---|---|
| `red-unproven` | the command never ran, timed out, or a different command was run |
| `red-not-red` | it PASSED before implementation — the test does not pin the behavior being built |
| `green-not-green` | it still fails after implementation |

`red-not-red` is the one worth understanding: a test that already passed proves nothing about the
work, and no self-reported "RED confirmed" can rule that out. This is why the command is read from
the authenticated expectation, which the implementing agent never sees and cannot edit.

**`redCommand` must be ONE INVOCATION, not a shell program.** Shell operators — `;` `&` `|` `` ` ``
`$` `>` `<` `(` `)` `{` `}` — are rejected by the task contract. Flags and quotes are fine:
`pytest tests/x.py -k "a or b"` is valid, `test -f /tmp/m || { touch /tmp/m; exit 1; }` is not. The
hook executes this string, so an unconstrained one is arbitrary code execution with the hook's
authority; an adversarial review built four separate bypasses out of it, and every one needed an
operator — fabricating RED with a marker file, alternating a counter across a wave, mutating a
declared output after adjudication, and exfiltrating while looking like a test run.

**What this does not close.** The command still loads code the implementer may control — a test
file, a `conftest.py`, a fixture. Authenticating the command string does not authenticate what it
transitively imports, so an implementer permitted to edit the test it is judged by can still run
code inside the probe. Narrow the task's `writablePaths` when that matters. The probe also runs
after the post-dispatch observation, so a tree mutation there is detected and reported as a
violation rather than silently adjudicated against stale bytes.

Every task's `work` and `criteria` also require: write and run the named test against missing
behavior; observe and report a valid RED; only then implement; run the exact verify command to
GREEN; report changed files and raw evidence. A doer never verifies its own task. An independent fresh verifier
checks each criterion and named evidence after the runner returns. On failure, create or update the
corresponding TaskList finding/retry dependency and resume only affected attempted work.

## Transition

After all current-hash implementation items independently pass, run `dev-test-gaps`. Its returned
requirement-to-test matrix, not a visible validation ledger, is the quality-gate result. Clear the
goal after terminal verification PASS, then continue to `dev-review`.

## Red flags — STOP

- About to trust a task report as verification: run the fresh verifier.
- About to write a dev task with no `redCommand`: STOP — the preflight refuses the wave, and a
  test-first workflow that takes the test on trust is not test-first.
- About to mark a plan checkbox or append a progress ledger: update TaskList instead.
- About to change requirements, architecture, dependencies, test contract, or evidence: return to
  native planning for a new generated plan and receipt rollover.
- About to use an old fixed plan or legacy artifact: it is conversion-only provenance, never live
  authority.
