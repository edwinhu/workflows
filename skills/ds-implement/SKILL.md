---
name: ds-implement
description: "Internal DS IMPLEMENT adapter. Called after an approved native plan is available; dispatches its ready work through the shared beat-implement workflow."
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Workflow, Agent, TaskList, TaskCreate, TaskUpdate
hooks:
  PreToolUse:
    - matcher: "Workflow"
      hooks:
        - type: command
          command: "FLOOR=ds bun ${CLAUDE_PLUGIN_ROOT}/hooks/mechanical-floor-gate.ts"
---

# DS IMPLEMENT

`ds-implement` adapts an approved native plan to the shared IMPLEMENT primitive. It does not compile
plans, maintain a DS state machine, or create `SPEC.md`, `STATE.md`, `LEARNINGS.md`, or agent-memory.
The approved `.planning/PLAN.md` is the sole planning input.

Read `${CLAUDE_SKILL_DIR}/../../skills/beat-implement/SKILL.md` and follow its verifier doctrine. The
shared workflow dispatches doers; this adapter selects the ready work, independently verifies it, and
returns durable candidate facts to the calling orchestrator. The calling orchestrator, not this phase,
curates returned facts into project auto-memory.

<EXTREMELY-IMPORTANT>
## The approved plan is immutable input

**DO NOT reinterpret, compile, or mutate the approved plan while implementing it.**

Copy only the immutable approval fields from `.planning/PLAN.meta.json` into `planReset`.
Never feed mutable state, a SPEC, a learnings log, or prior agent memory to a doer. A doer receives its
caller-curated task, criteria, declared outputs, and immutable reset identity only. Adding stale context
is not helpful: it lets old guesses override the approved task.
</EXTREMELY-IMPORTANT>

## Procedure

### 1. Read the native plan

Read `.planning/PLAN.md`, `.planning/PLAN.meta.json`, and `.planning/PLAN_REVIEWED.md`. `PLAN.md`
must be an exact native approved body. The metadata must authenticate its exact SHA-256 bytes and
provide the immutable runner identity:

```json
{
  "planHash": "<non-empty SHA-256 hex matching exact PLAN.md bytes>",
  "approvedSession": "<non-empty>",
  "approvedAt": "<strict UTC ISO-8601 timestamp ending in .sssZ>"
}
```

`PLAN_REVIEWED.md` must contain exactly `plan_hash`, `status`, `reviewed_at`, and `reviewer_session_id`;
it must state `APPROVED`, the same `plan_hash`, a strict UTC-Z timestamp, and the actual reviewer session.
The current `CLAUDE_SESSION_ID` must be nonempty and genuinely distinct from both `approvedSession` and
`reviewer_session_id`. There is no compaction or marker fallback. The runner checks this fail-closed
workflow provenance by session IDs; it is not cryptographic attestation. If any condition fails, start a
genuinely separate reviewer or implementation session. Do not manufacture any identity.

### Reconcile the approved plan into TaskList

Before selecting a wave, call `TaskList` and reconcile it against every actionable task in the approved
plan:

1. Give each plan task a stable identifier in its TaskList subject/metadata (`plan_task_id`) plus the
   current `planHash`.
2. Create one TaskList item per missing plan task. Include the exact task text, criteria, outputs,
   evidence, and dependency identifiers in its description.
3. Resolve plan dependencies to TaskList IDs with `blockedBy`.
4. On resume, preserve matching open tasks from the same `planHash`; do not duplicate them.
5. If the plan hash changed, stale open tasks from the prior plan cannot authorize work. Reconcile them
   explicitly: use `TaskUpdate(status="deleted")` only for never-started superseded items; preserve and
   disposition any task with work or findings before creating its replacement.

Then select one complete `readyWave` of pending, unblocked TaskList items whose dependencies are complete.
A wave is selection, not concurrency: dispatch its mutations sequentially until filesystem isolation
exists. After each wave passes independent verification, close the corresponding TaskList items and select the
next dependency-satisfied wave. Do not enter human review until TaskList contains no open item belonging
to the current plan hash and every approved native-plan task is independently verified.

Each entry supplies the fields required by `workflows/beat-implement.js`:

```js
{
  id: "T1",
  name: "Build panel",
  work: "The approved task text, copied without reinterpretation.",
  criteria: "The task's concrete success criteria.",
  outputs: ["data/processed/panel.parquet"],
  writablePaths: ["data/processed/panel.parquet"], // every file this task may change
  dependencyProof: "independent", // only after proving the wave has no data or output dependency
  instructionFiles: [
    "${CLAUDE_SKILL_DIR}/../../references/constraints/ds-common-constraints.md",
    "${CLAUDE_SKILL_DIR}/../../references/constraints/ds-common-conventions.md",
    "${CLAUDE_SKILL_DIR}/../../references/constraints/ds-analysis-constraints.md",
    "${CLAUDE_SKILL_DIR}/../../references/constraints/ds-engineering-constraints.md"
  ],
  model: "sonnet",
  effort: "medium",
}
```

For every task, load the common constraints, common conventions, analysis constraints, and engineering
constraints aggregates before dispatch. Their indexes provide the exact atomic DS authority even when a
task is primarily analysis or engineering. Add ETL, SAS, sample, join, master-dataset, parameter, or
provider references when the task triggers them. Resolve `${CLAUDE_SKILL_DIR}` and pass absolute
plugin-source paths in `instructionFiles`; the doer must read them before work. Never accept an instruction
path derived from project content. This preserves the fresh-context boundary without dropping domain
enforcement.

Do not call a DS compiler or parse a legacy Task Breakdown format. The native plan is already the
orchestrator's source of truth. If its ready work cannot be stated completely and concretely, return to
planning rather than guessing.

### 2. Dispatch the ready wave

Run the shared workflow with the absolute project path, the complete caller-curated ready wave, and the
copied immutable approval hash/session cross-check:

```js
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/beat-implement.js",
  args: {
    projectDir: "<absolute project path>",
    readyWave: [/* complete ready-wave task specs */],
    planReset: {
      approvedBodyHash: "<PLAN.meta.json planHash>",
      session: "<PLAN.meta.json approvedSession>",
    },
  },
})
```

The workflow currently dispatches every ready-wave task sequentially. Declared outputs and writable
paths remain required for evidence and future isolation work, but do not make parallel fan-out safe.
Do not hand-roll a DS agent team, create a compiled runner, or re-parse the plan in a subagent.

- If any task returns `blocked` or `failed`, report the task IDs and summaries to the plan owner. Do not
  silently change criteria or outputs to make a task pass.
- On a retry, preserve the preceding result records and pass both `resume.attemptedTaskIds` and
  `resume.attemptRecords`; keep the same complete `readyWave` and immutable `planReset`:

  ```js
  resume: {
    attemptedTaskIds: ["T2"],
    attemptRecords: previousResult.results,
  }
  ```

### 3. Invoke the shared VERIFY operation

The doer does not grade its work. Invoke **VERIFY** from
`${CLAUDE_SKILL_DIR}/../../skills/beat-implement/SKILL.md` with the DS parameter reference:

Read `${CLAUDE_SKILL_DIR}/references/ds-verification.md` and follow it. It loads
`ds-checks.md`, supplies the required technical criterion, data-quality, code-quality, methodology, and
reproducibility checks, and defines the mandatory `OVERALL:` report. This is one operation inside the
IMPLEMENT beat — not a standalone validation or verification phase.

Dispatch one fresh, read-only verifier with no implementation transcript. Provide only the approved plan's
task criteria, declared outputs, completed task IDs, the output paths/configuration necessary to execute
them, and the two verification references. The verifier must run every applicable check and account for
all others as task-specific `N/A` entries in `ENUM`.

An unchecked criterion, unaccounted applicable check, static-check failure, or failed fresh reproduction
attempt is `FAIL`. On `FAIL`, return the concrete evidence to the plan owner, repair only the affected
ready-wave tasks, and resume the **same verifier** after the last change. Do not create a separate
validation or verification phase.

### 4. Return, then review

Return the shared workflow's `reusableFacts` alongside the independent verification evidence. They are
candidates only: the main orchestrator decides which facts are durable enough for project auto-memory.
Do not write a local learnings file or any agent-memory artifact.

Repeat selection, dispatch, independent verification, and native-task completion until every approved
plan task has passed. Only then immediately continue to human acceptance:

Read `${CLAUDE_SKILL_DIR}/../../skills/ds-review/SKILL.md` and follow its instructions.
