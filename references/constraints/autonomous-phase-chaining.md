---
name: autonomous-phase-chaining
description: Phases auto-chain at human-verify gates and pause only at decision gates
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

The writing workflow supports autonomous execution. Phases chain automatically without human intervention at `human-verify` checkpoints (see checkpoint-type-classification convention).

**How it works:**
1. After each phase gate passes, check the checkpoint type
2. `human-verify` gates -> auto-advance to next phase (no pause)
3. `decision` gates -> pause, present options, wait for user choice
4. After each phase completes, re-read ACTIVE_WORKFLOW.md to catch state changes

**Smart Discuss:** When multiple ambiguities arise within a phase, batch them into a single `AskUserQuestion` call instead of asking sequentially. Present all grey areas at once for one human response.

**Blocker handling:** When execution fails at any point:
- Offer: retry / skip / stop
- If retry fails twice: escalate to user with diagnosis

**This means a typical writing workflow pauses only 3 times for genuine decisions** (domain selection, drafting strategy, review strategy) rather than 9 times for every gate. The reviewer gates, draft completeness gate, and completion verdict all auto-advance.

### No Pause Between Phases

After completing any phase and passing its gate, IMMEDIATELY load the next skill and execute it. Do NOT:
- Ask "should I continue?"
- Summarize what you just did
- Wait for confirmation

**Pausing between phases is procrastination disguised as courtesy.** The gate passed. The user confirmed (where required). Load the next skill.

### Topic Change Protocol

**If the user sends a message that is NOT about the current writing workflow, you MUST announce the pause before responding. This is not negotiable.**

This pattern was discovered in dev-debug (March 16, 2026) when a user asked an off-topic question mid-debug-loop. The agent silently abandoned the protocol and never resumed. The user had to re-invoke the workflow.

**Protocol:**
1. Announce: "Pausing writing workflow to address your request."
2. Handle the off-topic request (normal tools allowed -- you're outside the workflow)
3. Announce: "Resuming writing workflow. Reading ACTIVE_WORKFLOW.md for current state."
4. Read ACTIVE_WORKFLOW.md, reload constraint layers, continue at current phase

**If the user's message could be interpreted as EITHER a new topic OR part of the writing workflow:**
- Ask: "Is this related to the current writing project, or a separate request?"
- Do NOT assume it's separate and abandon the workflow silently

**Silent workflow abandonment is NOT HELPFUL -- the user invoked /writing because they want structured writing. Silently dropping the structure wastes their explicit request and forces them to re-invoke.**

## Rationale

**Why this exists** -- without autonomous chaining, the workflow pauses 9 times across 6 phases, each time asking "should I continue?" The user invoked /writing for end-to-end structured writing, not for an interactive approval session. The topic change protocol was added after the March 16, 2026 dev-debug incident where an off-topic question caused silent workflow abandonment -- the agent never resumed and the user had to re-invoke.

## Examples

### Correct

```
# After outline reviewer returns APPROVED (human-verify gate):
Gate passed. Auto-advancing to Draft phase.
[Immediately loads writing-draft skill and begins work]

# User asks off-topic question mid-workflow:
"Pausing writing workflow to address your request."
[Handles question]
"Resuming writing workflow. Reading ACTIVE_WORKFLOW.md for current state."
[Reads state, reloads constraints, continues]

# Multiple ambiguities in one phase:
"I have 3 questions before proceeding with this section:
1. Should CLAIM-02 evidence come from the 2019 or 2023 study?
2. Is the policy recommendation prescriptive or suggestive?
3. Should Part III include a counter-argument section?"
[One question, one response, continues]
```

### Incorrect

```
# After outline reviewer returns APPROVED:
"The outline has been approved by the reviewer! Here's a summary of what was covered:
- Part I covers CLAIM-01...
- Part II covers CLAIM-02...
Should I proceed to the drafting phase?"
(Unnecessary summary. Unnecessary question. Gate passed. Auto-advance.)

# User asks off-topic question:
[Answers question]
[Never mentions the workflow again]
(Silent abandonment. User has to re-invoke /writing.)

# Multiple ambiguities:
"Should CLAIM-02 use the 2019 study?"
[Waits for answer]
"Should the recommendation be prescriptive?"
[Waits for answer]
"Should Part III have counter-arguments?"
[Waits for answer]
(Three pauses instead of one batched question.)
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Let me summarize before continuing" | Summaries at phase boundaries are procrastination. The phase summary is in PHASE_SUMMARY.md. | Auto-advance. The summary is already recorded. |
| "The user might want to pause here" | If the gate is human-verify, the answer is no. The checkpoint table defines this. | Check the table. Auto-advance at human-verify gates. |
| "The user clearly wants to switch topics" | Maybe, but announce the pause so the loop state is preserved | Announce pause, handle, announce resume |
| "I can handle this quickly and get back" | You'll forget to resume. The workflow dies silently. | Announce the pause explicitly |
| "The workflow is at a natural pause point" | No point is natural enough to silently abandon | Announce even at phase boundaries |
| "I'll remember to come back" | Context compression will erase your intent to resume | Announce resume, read ACTIVE_WORKFLOW.md |
| "Each question needs its own answer" | Batching respects the user's time. Sequential questions are interrupts. | Batch ambiguities into one Smart Discuss call. |

## Red Flags

- **"Should I continue?" after a human-verify gate** -- STOP. The gate passed. Auto-advance. Don't ask.
- **Summarizing the phase before moving on** -- STOP. That's procrastination. The summary is in PHASE_SUMMARY.md. Load the next skill.
- **Answering an off-topic question without announcing workflow pause** -- STOP. Announce the pause. Otherwise the workflow dies silently.
- **Forgetting to resume after handling off-topic request** -- STOP. Announce resume. Read ACTIVE_WORKFLOW.md. Reload constraints.
- **Asking questions one at a time when multiple ambiguities exist** -- STOP. Batch into one Smart Discuss call.
- **"I'll get back to the workflow after this"** -- STOP. Announce the pause NOW, not "after." Explicit state management.
