---
name: deviation-rules
description: 4-rule system for unplanned discoveries — R1-R3 auto-fix, R4 STOP for user decision
applies-to: [ds, ds-fix, ds-implement, ds-delegate]
---

## Rule

Implementation subagents follow a 4-rule system for unplanned discoveries:

- **R1-R3 (Auto):** Bugs, missing critical checks, and blockers are fixed automatically with output-first verification and tracked in `.planning/LEARNINGS.md`.
- **R4a/R4b (STOP):** Data assumption violations and methodology changes require user decision before proceeding.

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4.

Each task's LEARNINGS.md entry must include a deviation summary line. This is not optional — it's how we know what changed from the plan.

## Rationale

**Why this exists** — Without deviation rules, agents either silently change architecture (dangerous) or halt on trivial bugs (wasteful). The 4-rule system gives clear guidance: fix the mechanical stuff automatically, STOP for anything that changes what the analysis means.

## Examples

### Correct
```markdown
## Task 3: Merge datasets - COMPLETE
**Deviations:** R1: 1 (fixed dtype mismatch on join key), R2: 1 (added null check after merge), R3: 0, R4: 0
```

### Incorrect
```markdown
## Task 3: Merge datasets - COMPLETE
# No deviation tracking — we don't know what changed from the plan
```
