---
name: user-feedback-capture
description: User-typed feedback during a review stage becomes TaskList items before any of it is acted on
applies-to: [dev-verify, ds-fix, ds-review, writing-revise, writing-validate, workshop, workshop-revise]
---

## Rule

**NO ACTING ON REVIEW FEEDBACK WITHOUT CAPTURING IT FIRST. This is not negotiable.**

Every user message that arrives during a review, validation, or fix stage is decomposed into **one `TaskCreate` per distinct actionable item — before you touch anything.** Then work the queue.

The trigger is mechanical. It is not "if the feedback seems substantial," not "if there are several items," not "if a loop is running." **Every actionable item, always.** The judgment about whether an item is big enough to write down is precisely the judgment that loses items.

| Arrives as | Becomes |
|---|---|
| "the chart's y-axis is wrong, and table 3 lost its footnote" | Two tasks |
| "also, fix the typo in section 2" (a follow-up message) | One task, appended to the open queue |
| "why did you use a median here?" | One task — a question is actionable; it needs an answer |
| "looks good otherwise" | No task — nothing is actionable |

## During the round

`TaskList` is the **live queue**, not the record.

1. `TaskCreate` every item before acting.
2. `TaskUpdate` → `in_progress` when you start one, `completed` when it is genuinely done.
3. Work in **ID order**, not arrival order. The oldest open item is the one at risk.
4. **Close and record in one step** — the `TaskUpdate` and returned feedback disposition go together.
5. Before telling the user the round is handled, call `TaskList` and confirm that nothing is `pending` or `in_progress`.

New feedback arriving mid-round appends to the queue. It does not replace it or reorder it.

**If the TaskList tools are not available in the session**, write the items straight into the review's returned report as a checklist and work them from there. The tool is the convenient home for the queue, not the reason to have one — a missing tool does not suspend the capture requirement.

## Record each item as you close it

**Record the disposition in the same step as the `TaskUpdate` that closes the item.** Not at the end of the round: a completed task is destroyed, not archived, so after gate close there is nothing left to fold. A round that defers its bookkeeping has no bookkeeping.

For DS, `ds-review` owns human feedback only. It records each completed item's disposition in its returned review report; the main `ds` orchestrator curates reusable facts from that report into project auto-memory. Do not treat the review report as a technical verification artifact, and do not ask `ds-review` to run technical `VERIFY`.

| Stage | Durable record |
|---|---|
| `writing-validate` | Its validation ledger |
| `writing-revise` | Its durable revision record |
| `dev-verify` | Its durable verification record |
| `ds-review`, `ds-fix` | Returned report, then main-orchestrator curation into project auto-memory |
| `workshop`, `workshop-revise` | Their durable workshop record |

**Fold only into an artifact the stage writes.** `writing-revise` is the trap: `REVIEW.md` is its input and is regenerated on every iteration, so a disposition folded there is erased. For DS, the approved PLAN is immutable and is not a feedback ledger; project auto-memory is curated by the main orchestrator, not written wholesale by a review agent.

| Disposition | Means | Closes as |
|---|---|---|
| `addressed` | The responsible implementation role changed the work and returned evidence | `completed` |
| `answered` | It was a question; you explained | `completed` |
| `waived` | **The user** said no change is needed — in their words, never your inference | `completed` + `metadata.disposition = "waived"` |

**`completed` means the item is resolved, not that work was done.** All three dispositions close the task; the disposition says *how*. Closing without recording a disposition fabricates consent: status alone cannot distinguish "I fixed it" from "they told me not to." So every close carries its disposition in the returned record, and a waived one carries it on the task as well.

**Never `deleted`.** Deleting destroys the record of the user's decision, which is the one thing the durable record exists to keep.

## Rationale

The user reports problems as they notice them: one message per problem. Without capture, the newest message displaces the previous one and the earlier reports are gone — they exist nowhere but in a transcript that compaction will thin. The user then has to notice the same defect a second time and report it again.

**That is the anti-helpful failure.** It silently transfers the tracking burden to the person who already did the hard part — noticing. Their first report was work; dropping it wastes it and tells them their feedback does not stick, which trains them to re-report everything defensively.

A plan cannot solve this. The approved PLAN predates a review round and remains immutable; feedback arrives during the round. `TaskList` is the live structure when feedback lands, and the returned review report plus curated project auto-memory preserve its lasting outcome.

## Facts

- TaskList status is exactly `pending | in_progress | completed | deleted`. **There is no `waived` and no `rejected`.** The vocabulary is thinner than the dispositions, so status alone can never say *why* an item closed — which is why `metadata.disposition` and the durable record carry that.
- Leaving a waived item `pending` to "avoid claiming credit" deadlocks the round: the gate requires an empty queue, so an unresolvable item blocks every item behind it. Close it with its disposition recorded.
- **A completed task is destroyed, not archived.** Measured 2026-07-29: after closing 16 tasks, `TaskList` returned "No tasks found" and `TaskGet` on a closed id returned "Task not found" while the id counter kept climbing, so the ids were spent, not reused. `TaskList` shows *open work, not history*. Anything intended for later recording is already gone.
- The empty `TaskList` reads identically whether a round finished or was never captured. It checks open items only; it can never confirm what happened.
- `TaskCreate` always creates status `pending` with no owner; status cannot be set at creation. Claim work with a separate `TaskUpdate`.
- The `/goal` evaluator judges from the **transcript** and cannot open files. A round whose dispositions exist only in an artifact cannot be confirmed closed — restate the disposition list in the turn itself.
- `ds-fix/SKILL.md` said "Document each piece of feedback as a task" before this constraint existed, and items still evaporated: "task" named no mechanism, so it read as an intention rather than a tool call. A rule that does not name the tool does not fire.

## Red Flags

| Action | Why wrong | Do instead |
|---|---|---|
| About to answer the newest message while earlier items are still `pending` | Recency is not priority. The displaced items are exactly the ones that get lost, and the user already paid the cost of finding them | `TaskList` first, then work in ID order |
| About to skip `TaskCreate` because the item is "quick" | Quick items are the ones you keep in your head, and your head is what fails across a long round | Capture first, then do it — capture costs one call |
| About to close an item without recording its disposition | Status cannot distinguish "I fixed it" from "they told me not to" — a bare `completed` on a waived item records your dismissal as their decision | Close it with `metadata.disposition`, and quote the user in the durable record |
| About to `TaskUpdate … deleted` to clear a waived item | It destroys the record of the user's decision | Use `completed` + `metadata.disposition = "waived"` |
| About to close the gate without calling `TaskList` | "I think I got everything" is the belief that produced the bug | Call it. An open item blocks the gate |
| About to close a batch of items now and record outcomes "at the end" | Closed tasks are gone by then — `TaskGet` returns *Task not found* | Record the disposition and `TaskUpdate` in the same step, every time |
| About to ask `ds-review` to technically VERIFY a feedback item | That converts human review into technical implementation and duplicates the role that belongs to `ds-implement` | Capture the feedback; dispatch `ds-implement` for technical work if needed; let `ds-review` own the human-feedback disposition |

## Examples

### Correct

```
User: the y-axis label is wrong on fig 2, and table 3 lost its footnote
Agent (ds-review): TaskCreate("Fix fig 2 y-axis label"), TaskCreate("Restore table 3 footnote")
                   → returned review report: "implementation required" for both items
Agent (ds-implement): corrects both items and runs technical VERIFY → returns evidence
Agent (ds-review): TaskUpdate(1, completed) + returned review report: "fig 2 y-axis — addressed; implementation evidence received"
                   TaskUpdate(2, completed) + returned review report: "table 3 footnote — addressed; implementation evidence received"
                   TaskList → nothing open   (a check, not the record — both outcomes were already written)
Main ds orchestrator: curates reusable feedback facts from returned reports into project auto-memory.
```

The returned disposition rides along with each close. There is deliberately no final "and then write it all up" step: by then tasks 1 and 2 no longer exist.

### Incorrect

```
User: the y-axis label is wrong on fig 2, and table 3 lost its footnote
Agent: fixes the y-axis, reports back
       (the footnote is never mentioned again by either party)
```

```
User: don't worry about the footnote, that's intentional
Agent: TaskUpdate(2, completed)     ← closed with no disposition; the record now
                                       reads identically to "I fixed it"
```

Correct: `TaskUpdate(2, completed, metadata: {disposition: "waived"})`, and the returned review report records *waived — user: "that's intentional"*.
