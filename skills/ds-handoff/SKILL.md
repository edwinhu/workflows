---
name: ds-handoff
description: "Internal DS workflow session handoff helper."
user-invocable: false
disable-model-invocation: true
---

# Session Handoff

Create `.planning/HANDOFF.md` when a DS workflow must pause. The handoff gives a new session concise transient context; it does not replace the native workflow sources.

## The Iron Law of Handoff

<EXTREMELY-IMPORTANT>
**NO HANDOFF WITHOUT READING THE AUTHORITATIVE SOURCES FIRST.** Read the approved `.planning/PLAN.md` and `.planning/PLAN.meta.json`, call `TaskList`, and read relevant project auto-memory before writing.

A handoff based on recollection silently converts guesses into workflow state. That is not helpful to the next session; it creates rework and can resume the wrong task.
</EXTREMELY-IMPORTANT>

Do not create or read `SPEC.md`, `STATE.md`, `LEARNINGS.md`, or agent-specific memory. `PLAN.md` is the immutable approved plan; TaskList is the live task lifecycle; project auto-memory holds curated, reusable facts. Resolve project auto-memory through the session's canonical project-memory path; do not create directories or topic files from this helper.

## Process

### 1. Gather Current Context

1. Read `.planning/PLAN.md` exactly as approved and `.planning/PLAN.meta.json` for its hash identity. Do not edit either artifact.
2. Call `TaskList` and, where needed, `TaskGet` for live task status, ownership, dependencies, and current blockers.
3. Read only relevant topic files in the project's auto-memory directory. Treat these as reusable technical facts, not a transcript of every task.
4. Inspect `git status --short` and `git log --oneline -10` to identify in-flight and committed work.
5. Capture any session-only decisions, rejected approaches, or unanswered questions that are not represented by the sources above.

### 2. Assess Progress

Determine:

- The active workflow stage (`ds`, `ds-implement`, or `ds-review`).
- Completed, in-progress, blocked, and pending tasks from **TaskList**, not plan mutation.
- The next unblocked task and its dependencies.
- Verified pipeline state from project auto-memory and task evidence.
- Uncommitted changes, blockers, and exact unresolved decisions.

If a fact seems durable and reusable but is absent from project auto-memory, include it in the handoff under `Candidate Reusable Facts`; the main orchestrator decides whether to curate it later. Do not write project auto-memory yourself from this helper.

### 3. Write `.planning/HANDOFF.md`

Use this template. Replace every bracketed field; write `(none)` where appropriate.

```markdown
---
stage: [ds|ds-implement|ds-review]
active_task: [TaskList ID or none]
open_tasks: [count of pending, in_progress, and blocked TaskList items]
plan_hash: [PLAN.meta.json planHash for the currently approved PLAN.md]
status: paused
last_updated: [ISO 8601]
---
# Session Handoff

## Authoritative Sources Read
- Plan: `.planning/PLAN.md` + `.planning/PLAN.meta.json` ([planHash])
- TaskList: [summary of statuses and task IDs]
- Project auto-memory: [topic files consulted]

## Current State
[The active workflow stage, current task, current file/output, and specific current position.]

## Task Lifecycle
- Completed: [TaskList IDs and short evidence]
- In progress: [TaskList IDs, what is done, what remains]
- Blocked: [TaskList IDs and exact blocker]
- Next unblocked: [TaskList ID and dependency status]

## Verified Project Facts
- [Relevant reusable fact already supported by project auto-memory or task evidence, with source/location]
- (none)

## Candidate Reusable Facts
- [Short durable fact for the main orchestrator to consider curating into project auto-memory]
- (none)

## Decisions and Rejected Approaches
- [Decision or rejected approach]: [why]
- (none)

## Uncommitted Changes
- [file]: [what changed and why]
- (none)

## Exact Next Action
[One concrete first action, including the TaskList ID, relevant input/output path, and verification required.]
```

### 4. Verify the Handoff

Before announcing success:

1. **IDENTIFY** — `.planning/HANDOFF.md` exists.
2. **READ** — reread it after writing.
3. **VERIFY** — it names the PLAN hash, TaskList status, auto-memory sources consulted, task lifecycle, blockers, and one concrete next action.
4. **VERIFY** — no section substitutes `STATE.md`, `SPEC.md`, `LEARNINGS.md`, or agent memory for an authoritative source.
5. **CLAIM** — report the saved path, active stage, open-task count, and exact next action only if all checks pass.

## Red Flags — STOP

| About to | STOP because | Do instead |
|---|---|---|
| Infer task progress from PLAN text | PLAN is immutable approved intent, not lifecycle state | Call TaskList. |
| Treat auto-memory as a full execution log | It contains curated reusable facts only | Use TaskList, task evidence, and git state for execution progress. |
| Write a durable technical fact directly to memory | Curation belongs to the main orchestrator | Add it as a candidate reusable fact in the handoff. |
| Write a vague next action such as “continue task 3” | The new session must rediscover the actual work | Name the TaskList ID, concrete operation, relevant path, and verification. |
| Create STATE, SPEC, LEARNINGS, or agent-memory files | They conflict with the native architecture | Use PLAN, TaskList, project auto-memory, and this temporary handoff only. |

## Resume Rule

On resumption, treat `.planning/HANDOFF.md` as orientation only. First reread the current immutable PLAN, call TaskList, and read relevant project auto-memory; if the handoff conflicts with any of them, the authoritative source wins. Once that check succeeds, replace or delete the stale handoff as part of the resumed workflow.

After verification, announce:

```text
Handoff saved: .planning/HANDOFF.md
- Stage: [stage]
- Open tasks: [count]
- Next action: [one-line exact action]
```
