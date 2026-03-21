---
name: no-pause-between-phases
description: After passing a phase gate, IMMEDIATELY load and execute the next skill
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
check-script: checks/check-no-pause-between-phases.py
---

## Rule

After completing any phase and passing its gate, IMMEDIATELY load the next skill and execute it. Do NOT:
- Ask "should I continue?"
- Summarize what you just did
- Wait for confirmation

**Pausing between phases is procrastination disguised as courtesy.** The gate passed. The user confirmed (where required). Load the next skill.

## Rationale

**Why this exists** — unnecessary pauses between phases waste context window, break workflow momentum, and train the user to expect that every transition requires their input. The gate system already handles when human input is needed (decision gates) vs. when it is not (human-verify gates). Adding courtesy pauses on top of the gate system duplicates the decision point and slows autonomous execution.

## Examples

### Correct
1. PRECIS reviewer approves → Agent immediately loads writing-outline skill and begins outlining. No pause, no summary, no "shall I continue?"
2. Draft gate passes (all sections exist) → Agent immediately loads writing-validate. No confirmation request.

### Incorrect
1. PRECIS reviewer approves → Agent says "Great, the precis has been approved! Would you like me to proceed to outlining?" → User says "yes" → Agent finally loads the outline skill. Two wasted messages.
2. Draft phase completes → Agent summarizes all sections written → Asks "Ready for validation?" → Wastes context on a summary nobody asked for.

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The user might want to review before continuing" | That's what gates are for. The gate passed. | Load the next skill |
| "A summary helps the user understand progress" | Phase summaries go in PHASE_SUMMARY.md, not chat messages | Write to PHASE_SUMMARY.md, then load next skill |
| "It's polite to ask before continuing" | It's polite to respect the user's time. They invoked /writing for autonomous execution. | Load the next skill |
| "What if the user wants to stop here?" | They can interrupt at any time. Don't pre-emptively stop for them. | Load the next skill |

## Red Flags

- **"Should I continue to the next phase?"** → STOP. The gate passed. Load the next skill.
- **"Here's a summary of what we accomplished"** → STOP. Write to PHASE_SUMMARY.md, not chat. Load the next skill.
- **"Let me know when you're ready"** → STOP. The gate passed. The user is ready. Load the next skill.
- **"Before we move on..."** → STOP. Move on. Now.
