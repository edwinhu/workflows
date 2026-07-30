---
name: beat-review
description: "Shared REVIEW primitive — beat 5, human review. Two feedback channels (tuicr annotations and chat), both dispositioned into one ledger. Read by any phase that hands work to a person."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — REVIEW

`review = human`

The terminal beat. A verifier PASS says the work matches the criteria; **nothing has yet checked the
criteria against what the user actually wanted.** That is what this beat is for, and why it cannot be
replaced by another subagent, however adversarial.

**The caller supplies:** the review target and its ledger path (`.planning/REVIEW.md`,
`.planning/HUMAN_REVIEW.md`, `.planning/edit.log`, …). Read
`${CLAUDE_SKILL_DIR}/references/artifact-surfaces.md` and route each artifact to the appropriate human
review application while keeping required rendered evidence fresh.

<EXTREMELY-IMPORTANT>
## A rejection invalidates the criteria, not just the work

**`REJECT:` returns to CLARIFY. Never to the code.**

A verifier PASS means the work matches the criteria. So if the user rejects work that passed, the
*criteria* are what encoded something other than what they wanted. Treating a rejection as a pile of
tactical fixes patches the artifact and leaves the bad criteria in place; the next verifier run passes
again, and you hand back the same wrong deliverable with more confidence and a cleaner audit trail.

**That is the opposite of helpful: you converge, efficiently and verifiably, on the thing the user
already told you they did not want.**

On `REJECT:` — clear the goal, rewrite intent and criteria (do not append; the old rows are the ones
that passed while the user rejected), and re-enter CLARIFY. Cap it: two rejections means the task
needed a real spec, not a third guess.
</EXTREMELY-IMPORTANT>

## Two channels, and only one is durable by construction

Annotations land in a review tool with ids and a ledger. **Chat messages land nowhere** — the user
notices something, types it, you act, and the next message displaces it, so the third thing they
mentioned is the only one that survives.

**Every user message during this beat is decomposed into one `TaskCreate` per distinct actionable
item, before you act on any of it.** Mechanical, not a judgment call: not "if it's substantial," not
"if there are several." The judgment about whether an item is worth writing down is exactly the
judgment that loses items.

| Arrives as | Becomes |
|---|---|
| "the y-axis is wrong, and section 2 lost its footnote" | Two tasks |
| "also fix the typo" (a later message) | One task, appended — never replacing the queue |
| "why did you pick median here?" | One task; a question needs an answer |
| "rest looks fine" | No task |

Work the queue in **ID order** — the oldest open item is the one at risk — and call `TaskList` before
saying a round is handled.

**Write each item's ledger row in the same step that closes it.** Not at the end of the round: a
completed task is *destroyed*, not archived. Measured — after closing 16 tasks, `TaskList` returned
"No tasks found" and `TaskGet` on a closed id returned "Task not found," while the id counter kept
climbing. An end-of-round write-up finds nothing to write.

If the TaskList tools are unavailable, write the items straight into the ledger as a checklist. The
tool is the convenient home for the queue, not the reason to have one.

## Dispositions

| Disposition | Means | Closes as |
|---|---|---|
| `addressed` | You changed the work | `completed` |
| `answered` | It was a question; you explained | `completed` |
| `waived` | **The user** said no change is needed — their words, never your inference | `completed` + `metadata.disposition = "waived"` |

**`completed` means resolved, not that work was done.** All three close the task; the disposition says
how. What fabricates consent is closing an item *without* recording the disposition — the status alone
cannot distinguish "I fixed it" from "they told me not to." **Never `deleted`**: that destroys the
record of the user's decision, which is the one thing the ledger exists to keep.

Leaving a waived item `pending` to avoid claiming credit deadlocks the round — the gate wants an empty
queue, so one unresolvable item blocks every item behind it.

## Gate

Every annotation id has a disposition; every chat item appears in the ledger with a disposition;
`TaskList` reports nothing `pending` or `in_progress`; no `REJECT:` is outstanding; and the last
relaunch produced no new ids.

**The ledger is the evidence, not the queue.** An empty `TaskList` reads identically whether the round
finished or was never captured — it can check that nothing is open, never that anything happened.

## Red flags

| Action | Why wrong | Do instead |
|---|---|---|
| About to act on the newest message while earlier items are `pending` | Recency is not priority; the displaced items are the ones that get lost, and the user already paid the cost of noticing them | `TaskList` first, work in ID order |
| About to skip `TaskCreate` because an item is "quick" | Quick items are the ones you keep in your head, and your head is what a long round defeats | Capture first, then do it |
| About to close an item without recording its disposition | The status cannot tell "I fixed it" from "they told me not to" | Close it *with* the disposition, and quote them |
| About to close a batch and write the ledger "at the end" | The closed tasks are gone by then | Ledger row and close in the same step |
| About to work a `REJECT:` as a list of tactical fixes | The criteria passed and the user rejected anyway — patching re-ships the same wrong thing with a cleaner audit trail | Return to CLARIFY |
| About to mark something `waived` because it seemed minor | Waiving is the user's call; recording your dismissal as their decision fabricates consent | Ask. And do not reach for `addressed` instead — on an item you never fixed that is the same false claim in a different label |

## Facts

- TaskList status is exactly `pending | in_progress | completed | deleted` — no `waived`, no
  `rejected`. The vocabulary is thinner than the dispositions, which is why the ledger, not the queue,
  is the record.
- A completed task is destroyed, not archived. `TaskGet` on a closed id returns "Task not found."
- An empty review session is not proof of review: it cannot distinguish "read it and had nothing to
  add" from "never opened it." When the user says they reviewed, record **their words**, not your
  inference from an empty ledger.
