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
1b. **Offer governance adoption — only when the project is unmarked and the episode will change something.** Check for `.claude-workflows.json` at the project root. If it is absent, include an option set asking whether to adopt the transition machinery for this project, and say plainly what it buys: the turn-end gate can then refuse to end a turn while a review is owed, or while `.planning/` holds a plan-shaped file no receipt ever bound. Default to **no**. On yes, `Write` `.claude-workflows.json` with exactly `{"schemaVersion": 1, "governed": true}` — the guard permits that one creation and nothing else. If the write is denied, print the one-line command and move on; never retry with different content. **Ask once per project, and never re-ask a project that already declined in this session.**
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
| Write `.claude-workflows.json` without asking | Governance is a committed, repo-visible opt-in; writing it unasked commits a policy decision to the user's repository on their behalf | Offer it in the `AskUserQuestion` call and write only on yes. |
| Write the marker with `governed: false`, or edit an existing one | That is the kill switch, not the opt-in — and the guard denies it | Turning governance off is a human edit, and it should be a visible one-line diff. |
| Ask the third-party review question for a read-only episode | There is no diff to review, so the answer cannot change any work — it spends a scarce slot and trains the user to skim | Ask it only when the episode will change code. |
| Persist the opt-in anywhere but the plan | It would escape `planHash` and stop being visible in plan review — an unapproved step running under an approved plan's authority | Carry it into native Plan mode with the rest of the clarified intent. |

## Facts

- `AskUserQuestion` appends an “Other” option automatically.
- Batch questions into one call unless an answer determines the next question.
- **The cap is four questions per call, so the third-party slot costs a domain question.** That is why it is reserved only for code-changing episodes: at four slots, an unusable question is not free, it displaces one that would have changed the work.
- **The transition gates reach a project only if `.claude-workflows.json` is there.** Measured 2026-08-03: an approved-looking plan was handed to a fresh session as plain text and implemented in main chat — ~10 modules, 1,952 filings — with no Skill call, no delegated implementer, no verifier and no receipt, and no guard fired once. The turn-end gate that now catches that shape exits on the first line for any unmarked project. CLARIFY is where the offer belongs because it is the moment governance starts mattering and the user is already being asked.
- **Adoption and the third-party opt-in compete for the same four slots.** Both are code-changing-episode questions. If the cap binds, the domain questions win: an unmarked project stays unmarked for one more episode, which costs less than a domain question that would have changed the work.
- The default is OFF, and off is the *absence* of the line rather than a line saying no. Every plan approved before this feature existed therefore keeps authorising exactly what it did.
