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
1a. **Reserve the final slot for the third-party review opt-in — only when the episode will change code.** Every review surface in this repo is Claude reviewing Claude: IMPLEMENT dispatches a doer and then a *fresh* verifier, independent in context but identical in model and training, so a defect both instances share is invisible by construction. A different model is the only thing that can see it. Ask whether to run one, offer the adapters the registry ships **and the option of running several**, and default to **off**. Several is usually the better answer when the episode is worth reviewing at all: measured over three rounds of this feature, eight findings were raised and only one was found by more than one adapter — so picking a single provider discards most of what the step is for. The answer is carried into the plan like every other clarified decision — it is **not** persisted separately — so it binds to `planHash` and is visible in plan review. An absent line means the step does not exist.
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
| Ask the third-party review question for a read-only episode | There is no diff to review, so the answer cannot change any work — it spends a scarce slot and trains the user to skim | Ask it only when the episode will change code. |
| Persist the opt-in anywhere but the plan | It would escape `planHash` and stop being visible in plan review — an unapproved step running under an approved plan's authority | Carry it into native Plan mode with the rest of the clarified intent. |

## Facts

- `AskUserQuestion` appends an “Other” option automatically.
- Batch questions into one call unless an answer determines the next question.
- **The cap is four questions per call, so the third-party slot costs a domain question.** That is why it is reserved only for code-changing episodes: at four slots, an unusable question is not free, it displaces one that would have changed the work.
- The default is OFF, and off is the *absence* of the line rather than a line saying no. Every plan approved before this feature existed therefore keeps authorising exactly what it did.
