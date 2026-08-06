---
name: ds-handoff
description: "Internal DS workflow pause helper. Returns a verified resume summary; it never creates a planning artifact."
user-invocable: false
disable-model-invocation: true
---

# Session Handoff

When a DS workflow pauses, return concise orientation to the caller. Do **not** create, read, replace, or advertise `.planning/HANDOFF.md` (or any substitute planning ledger).

## Iron Law

**NO PAUSE SUMMARY WITHOUT READING CANONICAL CONTINUITY FIRST.** Resolve and read the receipt-selected generated plan, call `TaskList`, and read relevant project auto-memory before returning a summary.

A summary from recollection turns guesses into a competing state record. The authenticated `{planFile, planHash}`, TaskList, and curated memory remain authoritative after the caller receives it.

Do not create or read `SPEC.md`, `STATE.md`, `LEARNINGS.md`, agent-specific memory, or a handoff file.

## Process

1. Resolve the receipt-selected generated plan and verify its authenticated hash. Do not edit the plan or hook-owned receipt.
2. Call `TaskList` and `TaskGet` where necessary for live status, ownership, dependencies, and blockers.
3. Read only relevant project auto-memory topics. These hold reusable facts, not an execution transcript.
4. Inspect `git status --short` and `git log --oneline -10` for in-flight and committed work.
5. Identify the active stage, next unblocked TaskList item, exact unresolved decisions, and any durable facts the caller may later curate.

## Return Contract

Return this summary directly to the caller; do not persist it:

```text
Pause summary
- Plan: receipt-selected `{planFile, planHash}`
- Stage: [ds | ds-implement | ds-accept]
- TaskList: [completed / active / blocked task IDs and concise status]
- Auto-memory consulted: [paths or none]
- Git state: [uncommitted changes or clean]
- Decisions / blockers: [exact items or none]
- Candidate reusable facts: [for the caller to curate, or none]
- Resume first action: [TaskList ID, operation, input/output, verification]
```

## Gate

Before returning the summary:

1. **IDENTIFY** — the receipt-selected `{planFile, planHash}` and active TaskList items.
2. **READ** — the selected immutable plan, TaskList context, and relevant auto-memory.
3. **VERIFY** — the next action names a TaskList ID, concrete operation, and verification.
4. **CLAIM** — return the summary only; do not claim that any new durable handoff state exists.

## Red Flags — STOP

| About to | STOP because | Do instead |
|---|---|---|
| Infer task progress from PLAN text | The plan is immutable approved intent, not lifecycle state | Call TaskList. |
| Treat auto-memory as a full execution log | It contains curated reusable facts only | Use TaskList, task evidence, and git state. |
| Persist a handoff or session summary | It creates competing modern planning authority | Return the summary to the caller. |
| Write a durable technical fact directly to memory | Curation belongs to the main orchestrator | Return it as a candidate reusable fact. |
| Resume from an old handoff file | Legacy text cannot authenticate current intent | Resolve the receipt-selected plan, TaskList, and memory anew. |
