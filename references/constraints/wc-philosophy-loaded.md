---
name: wc-philosophy-loaded
description: Workflow-creator must load PHILOSOPHY.md before any design work
applies-to: [workflow-creator]
---

## Rule

MODE 1 Step 1 MUST read PHILOSOPHY.md before proceeding. STATE.md must show `step: 1-philosophy, status: completed` before any design artifacts are written.

## Rationale

**Why this exists** — without philosophy grounding, generated workflows miss foundational principles (phased decomposition, gates, independent verification). The agent's training gives it plausible-looking but incomplete workflow patterns.

## Examples

### Correct
STATE.md shows `step: 1-philosophy, status: completed` before INTERVIEW.md or DESIGN.md exist.

### Incorrect
DESIGN.md exists but STATE.md shows no philosophy step — agent skipped straight to decomposition.

## Loading Facts

- Context doesn't persist across sessions — "I remember the philosophy from last time" is unreliable memory presented as a loaded artifact. Simple workflows drift fastest, so the read matters most exactly when it feels like overkill. Read it every time.
