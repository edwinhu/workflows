---
name: beat-clarify
description: "Shared CLARIFY primitive — ask the user, then carry evidence-bearing intent into the caller's authenticated generated-plan flow."
user-invocable: false
disable-model-invocation: true
---

# Beat primitive — CLARIFY

`clarify = ASK + criteria`

The opening beat for a workflow phase that starts with the user. It is shared by `ds`, `dev-clarify`, `writing-setup`, `workshop`, and `work` so each caller asks before it investigates.

**The caller supplies:** domain question axes and whether it is in a legacy conversion episode. For modern episodes, clarified intent belongs in native Plan mode and persists only as the receipt-selected immutable `{planFile, planHash}`. `TaskList` later owns live work; project auto-memory holds reusable facts.

A legacy `/dev` or legacy-only conversion path may read its isolated compatibility artifact, but it cannot use that artifact as authority for a newly started modern episode.

<EXTREMELY-IMPORTANT>
## Ask before you look

**No grep, task-file read, draft, or proposed approach until `AskUserQuestion` has run and the user has answered.** Existing shapes anchor the questions and can make the user ratify a framing they never chose. Loading this procedure is exempt.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Every criterion names its own evidence

**A criterion without checkable evidence is a wish.** Each row names its proof: an expected command result, required content, rendered observation, quotable source, or user judgment.
</EXTREMELY-IMPORTANT>

## Procedure

1. **Ask first.** Make one `AskUserQuestion` call with up to four questions, each with 2–4 options. Cover outcome, scope, constraints, and done-ness where answers materially change work. Always establish done-ness.
2. **Carry intent into canonical approval.** For modern workflows, place intent, exclusions, and evidence-bearing criteria in native Plan mode. The caller's approval/persistence flow creates the immutable generated plan and receipt; do not create `WORK.md`, `PRECIS.md`, `OUTLINE.md`, or another mutable planning ledger.
3. **Mark truly deferred evidence.** Write `TBD (<phase that will fill it>)` only where the current phase cannot know the evidence. Never invent a target.
4. **Handle legacy explicitly.** If a compatibility reader classifies the episode legacy-only, surface conversion to a fresh native plan and user approval. Preserve old files as provenance; never merge them with canonical authority.

## Gate

For a modern episode, native Plan mode contains the clarified intent and every criterion has concrete or explicitly deferred evidence. For a conversion episode, require a newly approved native plan before implementation. No modern continuation is admitted from a retired planning artifact.

## Red flags

| Action | Why wrong | Do instead |
|---|---|---|
| Read task files before the first question | Existing shapes anchor the user’s choices | Ask first. |
| Persist clarified intent into a retired Markdown ledger | It creates a competing source of truth | Carry it into native Plan mode. |
| Resume a modern episode from a legacy file | It cannot authenticate current approved intent | Resolve the receipt-selected `{planFile, planHash}`. |
| Write “works correctly” as evidence | It is unfalsifiable | Name the command, file, or observation. |
| Hand-write an “Other” option | `AskUserQuestion` provides one | Use the slots for real alternatives. |

## Facts

- `AskUserQuestion` appends an “Other” option automatically.
- Batch questions into one call unless an answer determines the next question.
