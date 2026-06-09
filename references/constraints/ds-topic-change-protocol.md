---
name: topic-change-protocol
description: Off-topic messages during active phase require announce-pause-handle-resume protocol
applies-to: [ds, ds-fix, ds-implement, ds-review, ds-verify, ds-delegate]
---

## Rule

When user sends an off-topic message during an active DS workflow phase, main chat MUST NOT silently switch context. Silent context switches kill iterative loops — the workflow state is lost, and the user must re-invoke the skill.

### The Protocol

```
User sends off-topic message during active phase
    ↓
1. ANNOUNCE: "Pausing [phase name] to address your request."
    ↓
2. HANDLE: Process the off-topic request (normal tools allowed outside the workflow loop)
    ↓
3. ANNOUNCE: "Resuming [phase name]. Reading state files for current progress."
    ↓
4. RELOAD: Read LEARNINGS.md / PLAN.md / SPEC.md to restore context
    ↓
5. RESUME: Continue from where you left off (spawn next subagent or proceed to next task)
```

### What Counts as Off-Topic

| Off-Topic (Pause Required) | On-Topic (No Pause Needed) |
|----------------------------|---------------------------|
| "What's in the raw data?" (exploration during implement) | "Should task 3 use median or mean?" (methodology question for current task) |
| "Generate a summary of results so far" (reporting during implement) | "The analyst asked about null handling" (answering subagent question) |
| "Can you check my other project?" (different project entirely) | "Skip task 4, it's not needed" (scope change for current workflow) |
| "Describe this image for me" (unrelated task) | "Add a new task after task 5" (plan modification for current workflow) |

## Rationale

**Why this exists** — Silent context switches kill iterative loops. Without the announce-pause-resume protocol, the workflow state is lost when the user sends an off-topic message. The user must re-invoke the skill and lose progress.

## Examples

### Correct
```
User: "What's in the cleaned data?" (during ds-implement)
Agent: "Pausing ds-implement to address your request."
Agent: [handles the data question]
Agent: "Resuming ds-implement. Reading state files for current progress."
Agent: [reads LEARNINGS.md, PLAN.md, continues from Task 4]
```

### Incorrect
```
User: "What's in the cleaned data?" (during ds-implement)
Agent: [silently reads CSVs, runs queries, answers question]
Agent: [implementation loop is dead, state is lost]
```
