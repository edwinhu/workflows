---
name: context-monitoring
description: No new phase without sufficient context — check remaining context before each phase
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise]
---

## Rule

Writing workflows span 6+ phases and multi-section documents. Context exhaustion is the #1 cause of lost work in long sessions.

<EXTREMELY-IMPORTANT>
### The Iron Law of Context Awareness

**NO NEW PHASE WITHOUT SUFFICIENT CONTEXT. This is not negotiable.**

Before starting any phase (especially Draft, Review, Revise), check remaining context:

| Level | Remaining Context | Action |
|-------|------------------|--------|
| **Normal** | >35% | Proceed normally |
| **Warning** | 25-35% | Complete current section/task, then invoke `writing-handoff` |
| **Critical** | ≤25% | Invoke `writing-handoff` IMMEDIATELY — no new work |

**Starting a 5-section draft phase with 20% context remaining produces garbage for the last 3 sections. Handoff now, resume fresh.**
</EXTREMELY-IMPORTANT>

## Rationale

**Why this exists** — writing workflows are the longest-running workflows in the system, spanning 6+ phases with multi-section documents. As context fills, output quality degrades silently: the agent produces text that looks fluent but misses constraints, drops structural connections, and introduces errors. The agent cannot reliably self-assess its own degradation. By the time quality visibly drops, 3+ sections may already be compromised. Handing off early (at 25-35%) preserves all work and lets a fresh session continue with full context.

## Examples

### Correct
1. Before starting the Draft phase, agent checks remaining context. At 30% (Warning level), agent completes the current section, then invokes writing-handoff with full state documentation.
2. At 24% context remaining, agent immediately invokes writing-handoff without starting any new work.

### Incorrect
1. Agent at 20% context begins drafting a new 5-section phase. Last 3 sections are degraded — hollow transitions, missed constraints, dropped claim IDs.
2. Agent notices degraded output quality but thinks "I'm almost done, just one more section" and pushes through. The section is garbage.

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'm almost done, just one more section" | "Almost done" is the most dangerous state — you'll produce degraded output | Handoff. The next session picks up clean. |
| "Handoff takes too long" | Handoff takes 2 minutes. Redoing 3 botched sections takes hours. | Write the handoff. |
| "I can tell I still have enough context" | You can't reliably self-assess context remaining | Check the signal (response quality, lost details) and err toward handoff |
| "The user wants this done now" | The user wants it done RIGHT. Degraded output wastes more time than a session break. | Handoff is faster than re-doing degraded work. |

## Red Flags

- **"Just one more section"** → STOP. Check your context level. If Warning or Critical, handoff.
- **"I can finish this"** → STOP. You can't reliably assess your own degradation. Check the numbers.
- **Output quality is dropping (vague transitions, generic phrasing, lost details)** → STOP. This IS context exhaustion. Handoff immediately.
- **"The handoff will confuse the user"** → STOP. A clean handoff is infinitely better than degraded output.
