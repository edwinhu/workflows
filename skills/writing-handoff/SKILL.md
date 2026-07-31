---
name: writing-handoff
description: "Internal writing pause helper. Resolves canonical continuity and returns a verified resume summary without writing a handoff artifact."
user-invocable: false
disable-model-invocation: true
---

# Writing Session Pause

Use this helper when a writing episode pauses. It returns orientation to the caller; it never creates, reads, replaces, or advertises `.planning/HANDOFF.md`.

## Iron Law

**NO PAUSE SUMMARY WITHOUT CANONICAL CONTINUITY.** Before returning a summary, resolve the receipt-selected `{planFile, planHash}`, call `TaskList`, read the relevant project auto-memory, inspect `drafts/`, `outlines/`, and `references/` as appropriate, then inspect git status and recent commits.

The immutable plan holds writing intent, claims, structure, source plan, outputs, and review surfaces. TaskList holds lifecycle state. Project auto-memory holds reusable facts. A pause summary is transient caller output, not planning authority.

## Process

1. Authenticate and read the selected generated plan. Do not edit it or its receipt.
2. Call `TaskList` and `TaskGet` as needed for current tasks, dependencies, and blockers.
3. Read relevant deliverables and project auto-memory; inspect `git status --short` and `git log --oneline -10`.
4. Identify current writing stage, active draft/output, completed and blocked task IDs, decisions not otherwise represented, and the exact next unblocked action.
5. Return the following summary directly to the caller:

```text
Pause summary
- Plan: receipt-selected `{planFile, planHash}`
- Stage and current output: [stage; draft/outline/reference path]
- TaskList: [completed / active / blocked IDs]
- Auto-memory consulted: [paths or none]
- Git state: [uncommitted changes or clean]
- Decisions / blockers: [exact items or none]
- Candidate reusable facts: [for caller curation, or none]
- Resume first action: [TaskList ID, concrete operation, paths, verification]
```

## Gate and red flags

Return only after the selected plan, TaskList, relevant memory, and deliverables support the next action. Do not infer progress from the plan, write a handoff document, or use retired précis, outline, active-workflow, validation, phase-summary, or learnings files as modern authority. A legacy-only episode must be explicitly converted into a freshly approved native plan before it becomes a modern continuation.
