# GOAL + WORK

Before selecting work, identify the exact `plan_file` and `plan_hash` in
`.planning/.state/review.json`. Run approved-artifact admission for `work`; use the authenticated
receipt-selected `planFile` and `planHash` unchanged. A pending receipt resumes at whole-plan review,
not implementation. Never derive approval identity from TaskList.

## Reconcile the approved plan into TaskList

Before selecting a wave, call `TaskList` and apply this deterministic reconciliation algorithm:

1. Index every existing item—pending, in progress, completed, and deleted—by
   `(planHash, plan_task_id, item_kind)`, where `item_kind` is implementation, verification, review,
   retry, or blocker.
2. For the current hash, reuse the unique matching item regardless of status. Completed same-hash tasks
   remain completed and are never recreated. Multiple live matches are a blocker requiring explicit
   deduplication; never choose one silently.
3. Create exactly one implementation item for each stable plan task lacking a current-hash match. Its
   metadata contains `plan_task_id`, `planHash`, and `item_kind: implementation`; its description
   preserves approved work, criteria, outputs, writable paths, evidence, instruction files, and
   dependency IDs without reinterpretation.
4. Resolve current plan dependencies only to current-hash implementation item IDs using `blockedBy`.
   Never carry a stale TaskList ID into a replacement task.
5. On plan-hash rollover, use `TaskUpdate(status="deleted")` only for a superseded item that was never
   started and has no findings or produced work. For every attempted implementation or associated
   verification, review, retry, or blocker item, set `status="completed"` and metadata
   `disposition: "superseded"` plus `superseded_by_plan_hash: <new hash>`. This terminal disposition
   preserves history without claiming it satisfies the replacement plan.
6. After dispositions, create exactly one current-hash replacement per stable task ID and resolve its
   dependencies only among the new current-hash set. Stale items and stale `blockedBy` links remain
   historical and cannot authorize or block current work.
7. Every new verification, review, retry, and blocker item carries the same `plan_task_id`, `planHash`,
   and explicit `item_kind` so findings cannot cross plan identities.

Select one complete ready wave of pending, unblocked current-hash tasks. A wave is selection, not
concurrency: dispatch mutations sequentially until workers have enforced filesystem isolation. After a
wave passes independent verification, close its TaskList items and select the next dependency-satisfied
wave. Human review waits until no current-plan task remains open.

## Activate the bounded goal

Get exactly one `/goal` active and pin it to the authenticated `planFile` and current TaskList task set.
The condition must carry a turn budget and restate proof in the transcript because the evaluator cannot
inspect disk.

`/goal` is a UI command, not a skill. Only the top-level session may ask the canonical helper to deliver
it; a spawned agent returns the literal command to its caller.

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal <condition>"
```

Use this condition shape:

```text
/goal Every current-plan criterion in the receipt-selected generated plan [planFile] ([planHash]) is
satisfied by its Evidence Plan and an independent verifier with no implementation context has returned
OVERALL: PASS after the last change. Restate the verdict table and raw evidence in the turn itself. Stop
after [N] turns.
```

Use 5 turns for routine work and 8–10 only for real unknowns. Proceed only when the helper returns
`{"status":"delivered",...}` or the user explicitly confirms the goal is active. Otherwise, print the literal command and stop.

Clear the goal immediately after independent `OVERALL: PASS`, before human review:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"
```

Proceed after delivery or explicit user confirmation; otherwise print `/goal clear` and stop. REVIEW waits for user input outside the autonomous loop. Tactical review fixes receive a new bounded repair goal and return to the same verifier. `REJECT:` clears the goal and replaces the plan before new work.

## Dispatch the ready wave

Pass the complete caller-curated wave to the authenticated shared runner:

Load and follow `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md`; it owns dispatch. Route the wave by
shape first, then dispatch what the route says — one task goes to a single subagent, a fan-out is
compiled into a generated workflow under `.claude/workflows/`.

```bash
echo "$READY_WAVE_JSON" | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/route-implementation.ts
# route == "workflow" -> generate the plan-bound script, then run it
echo '{"projectDir":"<absolute project path>",planFile: "<receipt plan_file>", planHash: "<receipt plan_hash>",
       "domain":"work","phases":[...],"tasks":[...]}' \
  | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/emit-implementation-workflow.ts
```

```js
Workflow({ scriptPath: "<path returned by the generator>", args: {} })
```

The domain supplies `phases` and each task's `prompt`; `planFile` and `planHash` come from the
receipt-selected plan and bind the generated script to it. There is no checked-in runner script to
invoke — the script is generated per plan, and a new plan hash produces a new script.

On retry, keep the same complete ready wave and `planReset`, and pass only proven attempted IDs plus the
preceding runner records. Records from another `planFile`, `planHash`, task fingerprint, or approval
session are ineligible. An implementation agent never verifies its own work.

## Red flags

| About to | Do instead |
|---|---|
| Recreate same-hash TaskList tasks on resume | Reuse the matching `plan_task_id` + `planHash` items |
| Carry open tasks across a plan-hash rollover | Delete only never-started items; disposition attempted work and create replacements |
| Call `Skill(goal)` or assume printed `/goal` text activated it | Use the top-level helper or return the literal command and stop |
| Continue after a helper result other than `status: delivered` | Stop until the user explicitly confirms activation |
| Run the helper from a spawned agent | Return the literal goal to the caller |
| Let a doer report serve as PASS | Run the independent verifier afterward |
| Hand-roll implementation dispatch | Use `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` with `workflow: "work"` |
