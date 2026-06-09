---
name: deviation-rules
description: 4-rule system for unplanned discoveries during drafting — R1-R3 auto, R4 STOP
applies-to: [writing-outline, writing-draft, writing-revise]
---

## Rule

Drafting subagents follow a 4-rule system for unplanned discoveries:

- **R1-R3 (Auto):** Factual errors, missing evidence, and structural blockers are fixed automatically and tracked.
- **R4 (STOP):** Argument restructuring requires user decision — may require OUTLINE.md revision.

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4.

Each section's summary must include a deviation tracking line. This is how we know what changed from the outline.

## Rationale

**Why this exists** — during drafting, subagents inevitably discover problems not anticipated by the outline: a cited source doesn't support the claim, a structural gap makes a transition impossible, or an argument needs restructuring. Without a classification system, agents either silently restructure the argument (dangerous) or stop for every minor correction (inefficient). The R1-R4 system draws a clear line: factual/evidence/structural fixes are auto-handled, but argument restructuring requires human approval because it changes what the document argues, not just how it argues it.

## Examples

### Correct
1. R1 (factual error): Source says 2019, outline says 2020. Subagent fixes the date, logs: "R1: Corrected date from 2020 to 2019 per [source]."
2. R2 (missing evidence): Claim lacks supporting citation. Subagent finds a citation in the references, adds it, logs: "R2: Added citation [X] to support CLAIM-03."
3. R3 (structural blocker): Transition between subsections is impossible with current ordering. Subagent reorders subsections within the section, logs: "R3: Reordered 2.1 and 2.2 for logical flow."
4. R4 (argument restructuring): The evidence contradicts the outline's central claim for this section. Subagent STOPS: "R4: Evidence contradicts CLAIM-02. Outline.md may need revision. User decision required."

### Incorrect
1. Subagent restructures the argument silently because "it's minor." The outline and draft now disagree. Nobody knows why.
2. Subagent stops for every date correction, asking the user about R1-level changes. Workflow grinds to a halt.
3. Subagent doesn't track deviations. After drafting, nobody knows what changed from the outline.

## Deviation Facts

- Adding a section is R4 even when it "won't change the argument" — new sections shift emphasis and flow, which changes what the document argues. A cost asymmetry decides unsure cases: a false R4 costs the user one quick decision; a false R3 is a silent argument change. Unsure → R4, always.
- Tracking a deviation costs ~30 seconds; an untracked change costs hours of "why did the argument change?" later. Track immediately in the section summary — a deferred note does not survive the section.

## Red Flags

- **Changing the argument structure without flagging R4** → STOP. If it changes what the document argues, it's R4.
- **"I'll track this deviation later"** → STOP. Track it NOW in the section summary.
- **"This is just a small structural change"** → STOP. Small structural changes compound. If it changes flow, it's R4.
- **No deviation tracking line in a section summary** → STOP. Every section summary MUST include deviation tracking, even if "deviations: none."
- **"The outline was wrong anyway"** → STOP. The outline is the contract. Changing it requires R4 and user approval.
