---
name: user-feedback-capture
description: User-typed feedback during a review stage becomes TaskList items before any of it is acted on
applies-to: [dev-verify, ds-verify, ds-fix, ds-review, ds-validate, writing-revise, writing-validate, workshop, workshop-revise]
---

## Rule

**NO ACTING ON REVIEW FEEDBACK WITHOUT CAPTURING IT FIRST. This is not negotiable.**

Every user message that arrives during a review, validation, or fix stage is decomposed into **one
`TaskCreate` per distinct actionable item — before you touch anything.** Then work the queue.

The trigger is mechanical. It is not "if the feedback seems substantial," not "if there are several
items," not "if a loop is running." **Every actionable item, always.** The judgment about whether an
item is big enough to write down is precisely the judgment that loses items.

| Arrives as | Becomes |
|---|---|
| "the chart's y-axis is wrong, and table 3 lost its footnote" | Two tasks |
| "also, fix the typo in section 2" (a follow-up message) | One task, appended to the open queue |
| "why did you use a median here?" | One task — a question is actionable; it needs an answer |
| "looks good otherwise" | No task — nothing is actionable |

## During the round

TaskList is the **live queue**, not the record.

1. `TaskCreate` every item, before acting.
2. `TaskUpdate` → `in_progress` when you start one, `completed` when it is genuinely done.
3. Work in **ID order**, not arrival order. The oldest open item is the one at risk.
4. **Close and record in one step** — the `TaskUpdate` and the ledger line go together.
5. Before telling the user the round is handled, **call `TaskList`** and confirm nothing is left
   `pending` or `in_progress`.

New feedback arriving mid-round appends to the queue. It does not replace it, and it does not
reorder it.

**If the TaskList tools are not available in the session**, write the items straight into the
stage's ledger as a checklist and work them from there. The tool is the convenient home for the
queue, not the reason to have one — a missing tool does not suspend the capture requirement.

## Record each item as you close it

**Write the ledger line in the same step as the `TaskUpdate` that closes the item.** Not at the end
of the round — see the Facts below: a completed task is *destroyed*, not archived, so by gate close
there is nothing left to fold. A round that defers its bookkeeping has no bookkeeping.

Each line goes in the ledger **that stage already writes**, with its disposition.

| Stage | Fold into |
|---|---|
| `ds-validate`, `writing-validate` | `.planning/VALIDATION.md` |
| `writing-revise` | `.planning/REVIEW_STATE.md` |
| `dev-verify`, `ds-verify`, `ds-review`, `ds-fix` | `.planning/LEARNINGS.md` |
| `workshop`, `workshop-revise` | `.planning/LEARNINGS.md` |

**Fold into a file the stage *writes*, never one it reads.** `writing-revise` is the trap:
`REVIEW.md` is its input, produced by `/writing-review` and **regenerated on every iteration** — a
disposition folded there is erased by the next loop. `REVIEW_STATE.md` is the artifact it owns and
carries across iterations. If a stage is ever added to `applies-to` without a row here, pick its
own state or summary artifact by that same test; do not assume `LEARNINGS.md` exists, because
`writing-revise` never writes one.

| Disposition | Means | Closes as |
|---|---|---|
| `addressed` | You changed the work | `completed` |
| `answered` | It was a question; you explained | `completed` |
| `waived` | **The user** said no change is needed — in their words, never your inference | `completed` + `metadata.disposition = "waived"` |

**`completed` means the item is resolved, not that work was done.** All three dispositions close the
task; the disposition is what says *how*. What fabricates consent is closing an item **without**
recording the disposition — the status alone cannot distinguish "I fixed it" from "they told me not
to." So every close carries its disposition into the ledger, and a waived one carries it on the task
as well.

**Never `deleted`.** Deleting destroys the record of the user's decision, which is the one thing the
ledger exists to keep.

## Rationale

The user reports problems as they notice them: one message per problem. Without capture, the newest
message displaces the previous one and the earlier reports are gone — they exist nowhere but in a
transcript that compaction will thin. The user then has to notice the same defect a second time and
report it again.

**That is the anti-helpful failure.** It silently transfers the tracking burden to the person who
already did the hard part — noticing. Their first report was work; dropping it wastes it and tells
them their feedback does not stick, which trains them to re-report everything defensively.

Planning files do not solve this. `SPEC.md`, `PLAN.md`, and `REVIEW.md` are authored *before* the
review round; the feedback arrives *during* it. TaskList is the only structure that exists at the
moment the message lands.

## Facts

- TaskList status is exactly `pending | in_progress | completed | deleted`. **There is no `waived`
  and no `rejected`.** The vocabulary is thinner than the dispositions, so the status alone can
  never say *why* an item closed — which is why `metadata.disposition` and the file ledger carry
  that, and why the ledger, not the queue, is the durable record.
- Leaving a waived item `pending` to "avoid claiming credit" deadlocks the round: the gate requires
  an empty queue, so an unresolvable item blocks every other item behind it. Close it with its
  disposition recorded.
- **A completed task is destroyed, not archived.** Measured 2026-07-29: after closing 16 tasks,
  `TaskList` returned "No tasks found" and `TaskGet` on a closed id returned "Task not found" — while
  the id counter kept climbing, so the ids were spent, not reused. `TaskList` shows *open work, not
  history*. Anything you meant to write down later is already gone. This is why the ledger line is
  written at close-time and why the file, not the queue, is the record.
- The empty `TaskList` therefore reads identically whether the round finished or the round was
  never captured. It is a check on open items only — it can never confirm that anything happened.
- `TaskCreate` always creates at status `pending` with no owner; status cannot be set at creation.
  Claim work with a separate `TaskUpdate`.
- The `/goal` evaluator judges from the **transcript** and cannot open files. A round whose
  dispositions exist only in a ledger cannot be confirmed closed — restate the disposition list in
  the turn itself.
- `ds-fix/SKILL.md` has said "Document each piece of feedback as a task" since before this
  constraint existed, and the items still evaporated: "task" named no mechanism, so it read as an
  intention rather than a tool call. A rule that does not name the tool does not fire.

## Red Flags

| Action | Why wrong | Do instead |
|---|---|---|
| About to answer the newest message while earlier items are still `pending` | Recency is not priority. The displaced items are exactly the ones that get lost, and the user already paid the cost of finding them | `TaskList` first, then work in ID order |
| About to skip `TaskCreate` because the item is "quick" | Quick items are the ones you keep in your head, and your head is what fails across a long round | Capture first, then do it — capture costs one call |
| About to close an item **without** recording its disposition | The status cannot distinguish "I fixed it" from "they told me not to" — a bare `completed` on a waived item records your dismissal as their decision | Close it *with* `metadata.disposition`, and quote the user in the ledger |
| About to `TaskUpdate … deleted` to clear a waived item | Destroys the record of the user's decision — the one thing the ledger exists to keep | `completed` + `metadata.disposition = "waived"` |
| About to close the gate without calling `TaskList` | "I think I got everything" is the belief that produced the bug | Call it. An open item blocks the gate |
| About to close a batch of items now and write the ledger "at the end" | The closed tasks are gone by then — `TaskGet` on a closed id returns *Task not found*. The end-of-round write has nothing to read | Ledger line and `TaskUpdate` in the same step, every time |
| About to handle a mid-loop interjection and resume without recording it | Announce-handle-resume leaves no trace; when the loop ends, the interjection is unrecoverable | `TaskCreate` it, then resume the loop |

## Examples

### Correct

```
User: the y-axis label is wrong on fig 2, and table 3 lost its footnote
Agent: TaskCreate("Fix fig 2 y-axis label"), TaskCreate("Restore table 3 footnote")
       TaskUpdate(1, in_progress) → fixes
         → TaskUpdate(1, completed) + VALIDATION.md line: "fig 2 y-axis — addressed"
       TaskUpdate(2, in_progress) → fixes
         → TaskUpdate(2, completed) + VALIDATION.md line: "table 3 footnote — addressed"
       TaskList → nothing open   (a check, not the record — both lines are already written)
```

The ledger line rides along with each close. There is deliberately no final "and then write it all
up" step: by then tasks 1 and 2 no longer exist.

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

Correct: `TaskUpdate(2, completed, metadata: {disposition: "waived"})`, and VALIDATION.md records
*waived — user: "that's intentional"*.
