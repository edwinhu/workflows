---
name: topic-change-protocol
description: If user sends a non-workflow message mid-workflow, announce the pause before responding
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

<EXTREMELY-IMPORTANT>
### The Iron Law of Topic Changes

**If the user sends a message that is NOT about the current writing workflow, you MUST announce the pause before responding. This is not negotiable.**

This pattern was discovered in dev-debug (March 16, 2026) when a user asked an off-topic question mid-debug-loop. The agent silently abandoned the protocol and never resumed. The user had to re-invoke the workflow.

**Protocol:**
1. Announce: "Pausing writing workflow to address your request."
2. Handle the off-topic request (normal tools allowed — you're outside the workflow)
3. Announce: "Resuming writing workflow. Reading ACTIVE_WORKFLOW.md for current state."
4. Read ACTIVE_WORKFLOW.md, reload constraint layers, continue at current phase

**If the user's message could be interpreted as EITHER a new topic OR part of the writing workflow:**
- Ask: "Is this related to the current writing project, or a separate request?"
- Do NOT assume it's separate and abandon the workflow silently

**Silent workflow abandonment is NOT HELPFUL — the user invoked /writing because they want structured writing. Silently dropping the structure wastes their explicit request and forces them to re-invoke.**
</EXTREMELY-IMPORTANT>

## Rationale

**Why this exists** — dev-debug (March 16, 2026) documented that when a user asked an off-topic question mid-debug-loop, the agent silently abandoned the protocol and never resumed. The user had to re-invoke the workflow from scratch. The same failure mode applies to writing: a casual question mid-draft causes the agent to drop the entire phased structure, losing all workflow state and forcing the user to restart.

## Examples

### Correct
1. User mid-draft: "What time is my meeting tomorrow?"
   - Agent: "Pausing writing workflow to address your request."
   - Agent checks calendar, responds.
   - Agent: "Resuming writing workflow. Reading ACTIVE_WORKFLOW.md for current state."
   - Agent reloads constraints, continues drafting.

2. User mid-review: "Can you look up the Smith v. Jones citation?"
   - Agent: "Is this related to the current writing project, or a separate request?"
   - User: "For the paper" → Agent handles within workflow context.

### Incorrect
1. User: "What time is my meeting tomorrow?" → Agent answers the question, never returns to the writing workflow. User has to re-invoke /writing.
2. User asks something ambiguous → Agent assumes it's a new topic, abandons workflow silently.

## Pause Facts

- Context compression erases an unannounced intent to resume — "I'll handle this quickly and get back" dies silently. The pause/resume announcements (plus re-reading ACTIVE_WORKFLOW.md) are the only state that survives; even a clear topic switch or a "natural pause point" gets announced.

## Red Flags

- **Answering a non-workflow question without announcing "Pausing writing workflow"** → STOP. You just silently abandoned the workflow.
- **"I'll get back to the writing after this"** → STOP. Announce the pause NOW, or you never will.
- **Assuming an ambiguous message is off-topic** → STOP. Ask the user: "Is this related to the current writing project?"
- **"The user seems done with writing"** → STOP. Unless they explicitly said so, they invoked /writing for a reason. Announce and confirm.
