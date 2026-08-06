---
name: writing-accept
description: "Terminal human-acceptance phase of the /writing workflow — presents verified prose and returns the user's decision. Invoked by the workflow; not user-invocable."
user-invocable: false
disable-model-invocation: true
---

# Writing human acceptance

This is the human acceptance beat. It does **not** perform prose, source-fidelity, or mechanical
review; those belong to `writing-verify`, which is independent MACHINE review of authenticated
PLAN-bound drafts. Passing `writing-verify` is evidence for this conversation, not acceptance by a
person — conflating the two is how a workflow ends up reporting "reviewed" for something no human
ever read.

Read `${CLAUDE_SKILL_DIR}/../beat-review/SKILL.md` and follow it. It owns human-feedback capture, the
task queue, dispositions, and the meaning of `REJECT:`.

## Why this adapter exists

`/writing` was the only workflow with no `beat-review` path: its flow ended
`→ /writing-revise → returned human review surface`, a terminal surface hand-rolled inside the
revision loop. Everything the beat defines — dispositions, the queue, what `REJECT:` means — was
therefore reimplemented per workflow, or simply absent. The domain framing belongs somewhere, and
that somewhere is here rather than inside the beat or inside `writing/SKILL.md`.

## Prepare the review

1. Resolve the exact receipt-selected generated plan from its authenticated `{planFile, planHash}`
   identity. Read its **Review Surfaces**; they define what the user should read. Do not substitute a
   fixed writing checklist — a plan that names its own surfaces is the authority on them.
2. Present those surfaces: the assembled prose, the machine review's resolved findings, and any
   `[CITE-NEEDED]` markers that survived. Ask for acceptance, tactical feedback, or `REJECT:`.
3. Return each feedback item, its disposition (`addressed`, `answered`, or user-authorized `waived`),
   and the resulting action through the review result and TaskList context. Do not create a planning
   Markdown ledger for review material.

## Route the outcome

- **ACCEPTED:** record the acceptance in the returned result and TaskList. The beat is complete.
- **Tactical feedback:** capture and disposition every item through `beat-review`, then send
  unresolved changes to `writing-revise` with the concrete returned items. Its independent
  `writing-verify` must re-run before this acceptance resumes. A reviser's claim that a finding is
  fixed is not a new acceptance.
- **`REJECT:`** is not tactical feedback. The prose passed independent machine review and the user
  still rejected it, so the receipt-selected plan's criteria were wrong. Mark the drafting and review
  invalidated in TaskList and return to `/writing` to clarify and bind a replacement plan. Do not
  patch the rejected plan, append criteria to it, or route this to `writing-revise`.

## Gate: exit ACCEPTANCE

1. **IDENTIFY:** the plan's Review Surfaces are the proof artifact.
2. **RUN:** every surface was actually presented to the user in this conversation.
3. **READ:** every returned item carries a disposition.
4. **VERIFY:** the user stated acceptance, or `REJECT:`. Silence is neither.
5. **CLAIM:** only then record the outcome.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Report `writing-verify` PASS as human acceptance | Machine review is not a person; the whole point of this beat is the person | Present the surfaces and wait for a decision |
| Treat no response as acceptance | An unanswered question is not a yes | Ask again, or return that acceptance is outstanding |
| Route a `REJECT:` to `writing-revise` | The criteria were wrong, not the prose | Return to `/writing` for a replacement plan |
