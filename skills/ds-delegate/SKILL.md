---
name: ds-delegate
description: "Compatibility-only helper for legacy or ad-hoc DS delegation."
user-invocable: false
disable-model-invocation: true
hooks:
  PostToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-post-subagent-guard.ts"
  PreToolUse:
    - matcher: "Agent"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-pre-subagent-clear.ts"
    - matcher: "Read"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Grep"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Glob"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/ds-read-after-subagent-guard.ts"
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
    - matcher: "Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow ds"
---

# DS Delegate Compatibility Path

`ds-delegate` is retained only for legacy or explicitly ad-hoc work. It is **not** the normal DS
implementation path: approved native-plan work must use `ds-implement` and its shared sequential
ready-wave runner plus independent verifier loop.

## The Iron Law of Delegation

<EXTREMELY-IMPORTANT>
**NO IMPLEMENTATION OUTSIDE A TASK AGENT.** The orchestrator delegates each approved task; it does not write analysis code, edit notebooks, run quick data checks, or make a one-off plot.

A shortcut that bypasses the agent's output evidence and technical review is not helpful: it leaves the user with an unverified analysis result.
</EXTREMELY-IMPORTANT>

Never call this from `ds-implement` for an approved native-plan task. Use it only when an explicit
legacy/ad-hoc compatibility request cannot use the native runner.

## Authoritative Context

Before dispatching, read:

1. `.planning/PLAN.md` — the exact, approved task text and acceptance criteria. **Do not edit it.**
2. `TaskList` — the live task ID, status, dependencies, and any task comments.
3. The project's auto-memory topic files — reusable, curated technical facts relevant to this task.

`PLAN.md` is the approved specification, TaskList is live workflow state, and project auto-memory is reusable project knowledge. The main orchestrator supplies exact relevant auto-memory topic-file paths; do not discover, create, or write auto-memory files. Do not create or use `SPEC.md`, `STATE.md`, `LEARNINGS.md`, or agent-specific memory files.

## Flowchart: Per-Task Implementation

This flowchart is authoritative.

```text
Read immutable PLAN + TaskList + relevant project auto-memory
                         |
                         v
              Dispatch appropriate implementer
                         |
              needs clarification? -- yes --> Record in TaskList; route scope changes through planning
                         |
                        no
                         v
            Read returned evidence and reusableFacts
                         |
                         v
       Technical PASS inside ds-implement? -- no --> Fix-and-verify loop (max 3)
                         |                                          |
                        yes                                    still failing
                         v                                          v
          Update TaskList / offer reusableFacts              Escalate to user
                         |
                         v
    Continue ds-implement; human ds-review only after all implementation tasks finish
```

## Select the Implementer

Use the full task text from `PLAN.md`, never a summary.

| Task type | Dispatch |
|---|---|
| `engineering` — ETL, schema, joins, pipelines, cleaning, transformations | `workflows:ds-engineer` |
| `analysis` — estimation, modeling, tests, visualization, summaries | `workflows:ds-analyst` |
| Missing or ambiguous | Default to `workflows:ds-analyst`; record the ambiguity in the task report. |

Match the model tier to the task: cheapest capable for mechanical one-file work, standard for integration, and the most capable available for methodology design or technical review.

## Dispatch Template

Dispatch one fresh implementation agent with the applicable constraints and this information:

```text
# Approved Task
[Paste the complete task text and acceptance criteria from .planning/PLAN.md]

# Live Task
TaskList ID: [id]
Status and dependencies: [live TaskList details]

# Project Context
[Only relevant, curated facts from project auto-memory]
[Relevant data/source paths and prior verified outputs]

# Required Work
- Implement only this approved task.
- Follow output-first verification: show the relevant before/after state, checks, and output locations.
- Load the applicable DS constraints and data-quality checks.
- Do not invent requirements. If the plan is ambiguous, stop and ask a precise question.
- Operational clarification may be recorded in TaskList. If it changes scope, acceptance criteria, methodology, deliverables, or data treatment, block the task and route it through planning for a newly approved PLAN.md; TaskList is not a substitute specification.
- Do not modify .planning/PLAN.md or create SPEC.md, STATE.md, LEARNINGS.md, or agent-memory.

# Return exactly
1. status: COMPLETE | BLOCKED | NEEDS_CLARIFICATION
2. evidence: commands/checks run, their salient results, and output file paths
3. changedFiles: files created or changed
4. blockersOrQuestions: [] or precise blockers/questions
5. reusableFacts: [] or short, durable project facts worth the main orchestrator considering for project auto-memory
```

For every compatibility task, require the agent to read all three aggregate indexes:

- `${CLAUDE_SKILL_DIR}/../../references/constraints/ds-common-conventions.md`
- `${CLAUDE_SKILL_DIR}/../../references/constraints/ds-analysis-constraints.md`
- `${CLAUDE_SKILL_DIR}/../../references/constraints/ds-engineering-constraints.md`
- `${CLAUDE_SKILL_DIR}/../../skills/ds-implement/references/ds-checks.md`

Add the task-specific atomic constraint files named by those indexes. Require deterministic schema and join checks for engineering work; require assumption, specification, robustness, and standard-error checks when applicable for analysis work.

## Post-Subagent Boundary

After an agent returns, read its returned report and evidence. Main chat may check that named outputs exist and may update TaskList, but it must not inspect source/data, run implementation code, query data stores, or repair the work. A failure or doubt goes back to a fresh implementation agent.

### Technical Verification Loop

`ds-implement` owns technical PASS. For each attempt:

1. **IDENTIFY** — map the returned evidence to the task's PLAN acceptance criteria.
2. **READ** — read the actual returned evidence, not a bare completion claim.
3. **VERIFY** — dispatch a fresh, read-only technical verifier for every task. For mechanical tasks its review may be limited to named PLAN acceptance checks and output evidence; for complex work it checks implementation and outputs in depth. It returns explicit `PASS` or actionable `ISSUES` with file references.
4. **CLAIM** — only a technical `PASS` permits the task to be marked complete in TaskList.

If evidence is absent, incomplete, or the verifier returns `ISSUES`, redispatch a fresh implementation agent with the exact findings. There are **at most three total fix-and-verify cycles per task**. After the third unresolved cycle, mark or retain the task as blocked in TaskList and escalate the specific evidence and blocker to the user.

Do not dispatch the human `ds-review` during this loop. `ds-review` is the post-implementation human review phase, after all implementation tasks have technical PASS.

## Close the Task

On technical PASS:

1. Update the corresponding TaskList item to completed, with concise evidence and output locations.
2. Return `reusableFacts` unchanged to the main orchestrator. The main orchestrator alone decides whether a fact is durable enough to curate into project auto-memory.
3. Immediately proceed to the next unblocked TaskList task. Do not pause between approved tasks.

## Red Flags — STOP

| About to | STOP because | Do instead |
|---|---|---|
| Edit or infer a new requirement from an implementation result | The immutable plan is the approved scope | Escalate the ambiguity or create a new TaskList task only through the approved planning path. |
| Mark a task complete from an agent's prose alone | A completion claim is not evidence | Read evidence and obtain technical PASS. |
| Write `LEARNINGS.md`, `STATE.md`, `SPEC.md`, or agent memory | These conflict with the native PLAN/TaskList/project-memory architecture | Return reusableFacts for the main orchestrator to curate. |
| Send work to `ds-review` before technical PASS | Human review cannot replace implementation verification | Finish the bounded technical loop inside `ds-implement`. |
| Fix an agent's work in main chat | It defeats delegated, evidence-based implementation | Redispatch a fresh task agent with precise findings. |

## Failure Handling

- **Needs clarification:** record the precise question and status in TaskList. Resolve an operational question before redispatching; if its answer changes scope, acceptance criteria, methodology, deliverables, or data treatment, block the task and route it through planning for a newly approved PLAN.md.
- **Missing outputs or failed checks:** redispatch with the missing evidence or verifier findings; do not investigate independently.
- **Task is no longer suitable for the approved plan:** do not mutate PLAN.md. Escalate or route the proposed change through the planning workflow.
- **Protocol violation:** if implementation was performed in main chat, delete that unverified work and restart the task through a fresh agent.
