---
name: beat-implement
description: "Shared IMPLEMENT primitive. Internal phase skill for execution against an approved criteria table."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — IMPLEMENT

`IMPLEMENT = GOAL + WORK + independent VERIFY`

The orchestration chat owns the active `/goal`, selects the ready wave, and owns the verifier loop.
The checked-in runner at `${CLAUDE_SKILL_DIR}/../../workflows/beat-implement.js` owns only direct
implementation dispatch. It receives a complete, approved work list; it never parses a plan, invents
a task, sets a goal, or verifies the work.

<EXTREMELY-IMPORTANT>
## The Iron Law of implementation and verification

**NO IMPLEMENTATION RESULT IS A VERIFIED RESULT. The doer never grades its own work.**

A task report says what the agent believes it did. Only a fresh verifier can establish that the
criteria hold. Treating a report as a pass ships untested assumptions to the user; that is not
helpful speed, it is deferred rework.
</EXTREMELY-IMPORTANT>

## Authoritative flow

```text
Orchestrator: select complete ready wave + start/maintain one /goal
       │
       ▼
Workflow(beat-implement.js): direct doer per supplied task
       │                         └─ sequential until filesystem isolation exists
       ▼
Orchestrator: curate reusableFacts → project auto-memory
       │
       ▼
Fresh verifier: VERIFY criteria
       │
       ├─ PASS → clear `/goal` via `bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"` → phase gate
       └─ FAIL → fix → resume the SAME verifier → re-check
```

This diagram is the specification. If surrounding prose conflicts with it, follow the diagram.

## 1. GOAL — one, confirmed, budgeted

Get exactly one `/goal` active, pinned to the criteria artifact and carrying a turn budget. Its
condition must be restated in the turn itself, not only in a file: the evaluator reads the transcript
and cannot inspect disk.

`/goal` is a UI command, not a skill. `Skill(goal)` fails and emitted text is a no-op. Only the
top-level session may activate it:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal <condition>"
```

Proceed only after the helper returns `{"status":"delivered",...}` or the user explicitly confirms the
goal is active. Otherwise give the literal `/goal` line to the caller and stop. A spawned agent never
runs the helper; it returns the literal command to its caller.

After the terminal verifier PASS, only the top-level session clears the goal:

```bash
bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts "/goal clear"
```

Enter the phase gate only after `status: delivered` or explicit user confirmation. Otherwise return the
literal `/goal clear` command and stop.

## 2. Curate the complete ready-wave spec

Before invoking the runner, the orchestrator constructs every task itself. Each item must contain:

```js
{
  id: "stable-task-id",
  name: "short task name",
  work: "complete approved implementation instruction",
  criteria: "task-local success criteria and evidence",
  outputs: ["concrete/project-relative/output-path"],
  // "independent" only after the orchestrator established no task consumes another's output.
  dependencyProof: "independent",
  model: "model supplied by the orchestrator",
  effort: "effort supplied by the orchestrator",
}
```

Also copy **only** this immutable hash/session identity from separate `.planning/PLAN.meta.json`
metadata:

```js
planReset: {
  approvedBodyHash: "<approved body hash>",
  session: "<approval session>",
}
```

Do not give a fresh doer `.planning/STATE.md`, `.planning/SPEC.md`, `.planning/LEARNINGS.md`, or
agent memory. These mutable artifacts smuggle prior interpretation into a approval boundary that is supposed to
be anchored solely to the approved plan identity.

### Dispatch safety

- Select dependency-satisfied ready tasks as one wave, but dispatch every mutation sequentially in
  stable ready-wave order until workers have enforced filesystem isolation.
- `writablePaths` and reported `changedFiles` remain defense-in-depth: every task must declare writable
  paths and every reported change must stay within them.
- Post-return manifests cannot authorize concurrency. Do not hand-roll parallel fan-out from apparently
  disjoint paths.

## 3. Invoke the checked-in runner

```js
const run = await Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/beat-implement.js",
  args: {
    projectDir: "<absolute project path>",
    workflow: "<ds|writing|workshop>",
    readyWave,
    planReset,
    // Only for a retry: do not send untouched work back through the runner.
    // attemptRecords are the preceding runner's result records; they prove retry scope.
    resume: {
      attemptedTaskIds: ["<previously-attempted-task-id>"],
      attemptRecords: previousRun.results,
    },
  },
})
```

The runner returns `{ executionMode, executionReason, resumedAttemptedWorkOnly, results,
reusableFacts, counts }`. Each result is exactly `implemented`, `blocked`, or `failed` and carries
its task id, summary, task-scoped reusable facts, the approved plan hash/session, and a deterministic
task-spec fingerprint. The retry gate matches those identity fields before it accepts an attempted id.

The runner uses flat dispatch: every doer is dispatched directly by the workflow. A doer may not
spawn a dispatcher or further implementation agents; nested delegation loses results and makes the
orchestrator unable to account for actual work.

After the return, curate `reusableFacts` before adding durable, project-specific facts to project
auto-memory. Returned facts are candidates, not automatic truth.

## 4. VERIFY — fresh, adversarial, and outside the workflow

Dispatch a fresh verifier after the runner returns. The verifier sees the criteria and artifacts, not
the doer's reasoning. It must run or inspect each named evidence source, record the raw result, and
return PASS or FAIL per row plus `OVERALL:`. Evidence it cannot check is FAIL.

On round two and later, resume the **same verifier**. Tell it: “assume nothing landed; re-check from
scratch” and “do not soften because you raised the finding.” A resumed verifier can confirm its own
finding was fixed; a replacement has to rediscover it and misses defects introduced during repair.

On a verifier FAIL, fix worst-first, then end the turn so the goal refires. Do not summarize or ask
whether to continue. If retrying implementation, pass only `attemptedTaskIds` for work previously
attempted; untouched tasks remain untouched.

## Gate: exit IMPLEMENT

1. **IDENTIFY:** The criteria artifact's verify log is the proof artifact.
2. **RUN:** The independent verifier runs after the last change.
3. **READ:** Read every row and its raw evidence.
4. **VERIFY:** `OVERALL: PASS` and no criterion was unchecked.
5. **CLAIM:** Only then record the PASS in the criteria artifact and leave IMPLEMENT.

PASS means the work matches current criteria. Goal-level validation remains a later beat.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Pass a plan path and ask the workflow to discover tasks | The runner is deliberately not a plan interpreter; it would make authority and retry scope ambiguous | Construct the complete ready wave in the orchestrator |
| Parallelize because tasks “look separate” | Post-return manifests cannot isolate concurrent mutations | Select the wave, then dispatch sequentially until filesystem isolation exists |
| Give a doer STATE, SPEC, LEARNINGS, or agent memory | Mutable context defeats the approval boundary and turns the approved plan into a suggestion | Pass only immutable PLAN identity fields |
| Treat `implemented` as PASS | The implementer is not an independent judge | Run the fresh verifier outside the workflow |
| Spawn a replacement verifier after a FAIL | It cannot close the findings it did not raise | Resume the named verifier |
| Retry every task after a localized failure | Replaying untouched work creates needless changes and fresh interference | Resume only previously attempted ids |

## Facts

- `/goal` is a UI command, not a skill; emitted `/goal` text is never dispatched.
- The `/goal` evaluator reads the transcript and cannot open artifacts.
- A workflow cannot accept mid-run human input. IMPLEMENT is workflow-safe because it contains no
  human gate; GOAL and VERIFY remain owned by the conversational orchestrator.
- The runner returns reusable facts for curation because automatically persisting an agent report
  would turn unreviewed output into project memory.
