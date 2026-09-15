---
name: topic-change-protocol
description: Off-topic messages during an active DS role require announce-pause-handle-resume
applies-to: [ds, ds-fix, ds-implement, ds-accept, ds-delegate]
---

## Rule

When a user sends an off-topic message during an active DS role, the orchestrator MUST NOT silently switch context. Silent switches kill iterative loops, obscure `TaskList` status, and force the user to re-establish progress.

### The Protocol

```
User sends off-topic message during active role
    ↓
1. ANNOUNCE: "Pausing [role name] to address your request."
    ↓
2. HANDLE: Process the off-topic request (normal tools allowed outside the workflow loop)
    ↓
3. ANNOUNCE: "Resuming [role name]. Restoring the approved PLAN, project auto-memory, and TaskList."
    ↓
4. RELOAD: Read the immutable approved PLAN and project auto-memory; call TaskList
    ↓
5. RESUME: Continue from the current approved task (dispatch the next agent or proceed to the next item)
```

### Scope changes

A request to add, skip, or revise an approved task is neither a normal pause nor a continuation. Capture it in `TaskList`, stop dispatching the current plan, and obtain a newly approved immutable PLAN before any work resumes. Do not run a superseded task merely because it was on the former plan.

### What Counts as Off-Topic

| Off-Topic (Pause Required) | On-Topic (No Pause Needed) |
|----------------------------|---------------------------|
| "What's in the raw data?" (exploration during implementation) | "Should this task use median or mean?" (methodology question for the current task) |
| "Generate a summary of results so far" (reporting during implementation) | "The analyst asked about null handling" (answer an agent question) |
| "Can you check my other project?" (different project entirely) | "Please address the reviewer comment about figure 2" (human feedback for the current review) |
| "Skip task 4, it's not needed" (scope decision — capture it, stop dispatch, and obtain a newly approved immutable PLAN before resuming) | "What does task 4's accepted output need to contain?" (clarification about the current approved task) |
| "Describe this image for me" (unrelated task) | "The task report is missing an output path" (follow up with the task agent) |

## Rationale

**Why this exists** — Silent context switches kill iterative loops. Without an announce-pause-resume protocol, the workflow loses the approved task, returned facts, and live queue when a user sends an unrelated message. The user must then reconstruct progress that the workflow should have preserved.

## Examples

### Correct
```
User: "What's in the cleaned data?" (during ds-implement)
Agent: "Pausing ds-implement to address your request."
Agent: [handles the data question]
Agent: "Resuming ds-implement. Restoring the approved PLAN, project auto-memory, and TaskList."
Agent: [reads the approved PLAN and auto-memory; calls TaskList; continues from the current task]
```

### Incorrect
```
User: "What's in the cleaned data?" (during ds-implement)
Agent: [silently reads CSVs, runs queries, answers question]
Agent: [implementation loop is dead and current work is no longer tracked]
```
