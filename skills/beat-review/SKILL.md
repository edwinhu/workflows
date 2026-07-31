---
name: beat-review
description: "Shared REVIEW primitive — present verified work to a person, capture actionable feedback in TaskList, and return the terminal decision to the caller."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — REVIEW

`review = human`

The terminal beat. A verifier PASS shows the work meets its criteria; only human review tests whether those criteria match what the user wanted. Modern workflows retain authority in the receipt-selected immutable `{planFile, planHash}`, TaskList, project auto-memory, project deliverables, and minimal `.planning/.state/` machine state. They do **not** create `REVIEW.md` or `HUMAN_REVIEW.md`.

**The caller supplies:** rendered review surfaces, plan identity, and the return channel for the terminal human decision. A legacy `/dev` compatibility path may use its isolated legacy contract; it is not a modern workflow authority.

<EXTREMELY-IMPORTANT>
## A rejection invalidates the criteria, not just the work

**`REJECT:` returns to CLARIFY, never directly to code.** If verified work is rejected, its criteria encoded the wrong outcome. Clear the goal, replace intent and criteria through a newly approved plan, and re-enter CLARIFY. Two rejections mean the task needs a real specification, not a third guess.
</EXTREMELY-IMPORTANT>

## Feedback and decision contract

1. Present fresh review surfaces with the receipt-selected `{planFile, planHash}`.
2. Convert each distinct actionable chat comment or annotation into one `TaskCreate` before acting. Work open feedback in TaskList ID order.
3. Record each task’s disposition (`addressed`, `answered`, or user-authorized `waived`) in the caller’s returned review result at the moment the task closes. TaskList is the live queue; the returned result is the user-visible review account. Do not create a review ledger.
4. Return one terminal decision to the caller:

```text
Human review result
- Plan: `{planFile, planHash}`
- Decision: ACCEPT | REJECT | CONTINUE
- Feedback tasks: [TaskList IDs with dispositions]
- User words supporting the decision: [verbatim or concise quote]
- Required next action: [none | TaskList ID | re-enter CLARIFY]
```

5. The caller may persist only the policy-approved minimal machine verdict in `.planning/.state/review.json`; review prose and findings remain in the returned result and TaskList.

## Dispositions

| Disposition | Meaning | TaskList closure |
|---|---|---|
| `addressed` | The work changed | `completed` |
| `answered` | It was a question and was answered | `completed` |
| `waived` | The user explicitly declined a change | `completed` with `metadata.disposition = "waived"` |

Never `deleted`: it destroys the record. A completed task is not a durable ledger, so return the disposition at close time.

## Gate

Every actionable comment is captured and dispositioned; `TaskList` has no pending or in-progress review feedback; `REJECT:` is either absent or has returned to CLARIFY; and the caller receives the terminal decision tied to `{planFile, planHash}`. Do not claim acceptance from an empty queue alone.

## Red flags

| Action | Why wrong | Do instead |
|---|---|---|
| Create `REVIEW.md` or `HUMAN_REVIEW.md` | It is retired modern authority | Use TaskList and the returned result. |
| Act on a comment before `TaskCreate` | The feedback can be lost | Capture it first. |
| Close an item without a disposition | Status cannot distinguish fixed from waived | Return its disposition when closing it. |
| Treat a `REJECT:` as tactical fixes | The criteria, not merely implementation, failed | Return to CLARIFY and replace the approved plan. |
| Mark a minor issue waived yourself | That fabricates user consent | Ask the user. |

## Facts

- TaskList status is `pending | in_progress | completed | deleted`; dispositions are richer and must be returned when a task is closed.
- A completed task may no longer be readable through `TaskGet`; do not defer recording its disposition.
- An empty review session does not prove review occurred. Return the user’s actual words, not an inference.
