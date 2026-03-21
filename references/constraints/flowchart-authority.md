---
name: flowchart-authority
description: If text and flowchart disagree, the flowchart wins — the flowchart IS the spec
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise, writing-precis-reviewer, writing-outline-reviewer]
check-script: checks/check-flowchart-authority.py
---

## Rule

Every phase skill has a flowchart. **If text and flowchart disagree, the flowchart wins.** The flowchart IS the spec — text is commentary.

## Rationale

**Why this exists** — flowcharts encode the authoritative process definition as a formal specification. Prose descriptions are explanatory commentary that may drift from the intended process over time. When there is any ambiguity or contradiction, the flowchart is the single source of truth. This prevents agents from cherry-picking whichever interpretation (text or flowchart) is more convenient.

## Examples

### Correct
1. Phase skill text says "optionally review the outline." Flowchart shows a mandatory review gate. Agent follows the flowchart: review is mandatory.
2. Agent encounters ambiguity in prose instructions. Consults the flowchart to determine the correct process step.

### Incorrect
1. Agent follows prose description that says "skip review if time is short" while the flowchart shows a mandatory review gate.
2. Agent invents a process step not in the flowchart because it "seems implied" by the text.

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The text explanation is clearer" | Clarity ≠ authority. The flowchart is the spec. | Follow the flowchart |
| "The flowchart seems outdated" | If it's in the skill, it's authoritative until changed | Follow the flowchart, flag concern to user |
| "Common sense says to skip this step" | The flowchart encodes the designer's intent, not your common sense | Follow the flowchart |
| "The text says I can take a shortcut" | Text is commentary. Flowchart is spec. | Follow the flowchart |

## Red Flags

- **"The text says something different from the flowchart"** → STOP. Follow the flowchart. It wins.
- **"I'll interpret the flowchart loosely"** → STOP. Flowcharts are precise specifications, not suggestions.
- **"This flowchart step seems unnecessary"** → STOP. Every step exists for a reason. Follow it.
