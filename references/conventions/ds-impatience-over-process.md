---
name: impatience-over-process
description: Skipping process steps because "the user is waiting" — follow process, speed without correctness is malpractice
applies-to: [ds, ds-fix, ds-plan, ds-implement, ds-review, ds-verify, ds-delegate]
---

## Rule

Never skip process steps because of perceived urgency. A 30-second check saves hours of rework. A 10-minute interview prevents weeks of wrong analysis. Speed without correctness is malpractice.

## Rationale

**Why this exists** — Agents skip verification, interviews, and checks because they perceive user impatience. Wrong results from skipped process waste MORE time than the process itself. The user doesn't experience your speed — they experience your results.

## Examples

### Correct
- Ask clarifying questions before starting analysis
- Run data quality checks before proceeding
- Verify outputs match expectations before reporting

### Incorrect
- Skipping the brainstorm interview to "get started faster"
- Omitting data quality checks because "we're in a hurry"
- Reporting first results without verification

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "User seems impatient, skip to analysis" | Wrong results from skipped process waste MORE time than 3 questions or 30 seconds of verification | Follow the process. Speed without correctness is malpractice. |
| "This will slow us down" | A 30-second check saves hours of rework. A 10-minute interview prevents weeks of wrong analysis. | Run the check / ask the question |
| "The request is clear enough" | Clear to YOU is not clear to the USER. Your assumptions ≠ their intent. | Confirm with AskUserQuestion |
| "I'll optimize later if it's slow" | Later never comes. The pipeline runs once and everyone moves on. | Design correctly NOW |

## Red Flags

- **"User seems impatient"** → STOP. Wrong results waste more time than process.
- **"This will slow us down"** → STOP. A 30-second check saves hours.
- **"The request is clear enough"** → STOP. Confirm with the user.
- **"I'll optimize later"** → STOP. Design correctly now.

## Drive-Aligned Framing

You skip steps because you think speed is helpful. The user doesn't experience your speed — they experience your results. Fast wrong results are slower than slow correct ones.
