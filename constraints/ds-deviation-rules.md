---
name: deviation-rules
description: 4-rule system for unplanned discoveries — R1-R3 auto-fix, R4 STOP for user decision
applies-to: [ds, ds-fix, ds-implement, ds-delegate]
---

## Rule

Implementation agents follow a four-rule system for unplanned discoveries:

- **R1-R3 (Auto):** Bugs, missing critical checks, and blockers are fixed automatically with output-first verification. Record the deviation and disposition in the relevant `TaskList` task and the worker's structured result; return reusable facts for the orchestrator to curate as project auto-memory candidates.
- **R4a/R4b (STOP):** Data assumption violations and methodology changes require user decision before proceeding; record the blocked decision in `TaskList` and the structured worker result.

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4.

The implementation report must identify each deviation, its rule, and disposition. The approved PLAN remains immutable: neither an agent nor the orchestrator rewrites it to make a deviation look planned.

## Rationale

**Why this exists** — Without deviation rules, agents either silently change methodology (dangerous) or halt on trivial bugs (wasteful). The four rules give clear guidance: fix mechanical issues automatically, STOP for anything that changes what the analysis means. Rewriting the plan after the fact would erase the difference and make technical evidence less useful to the user.

## Examples

### Correct
```markdown
## Task 3: Merge datasets — COMPLETE
**Deviations:** R1: 1 (fixed dtype mismatch on join key), R2: 1 (added null check after merge), R3: 0, R4: 0
**Reusable facts:** Join key requires normalized string dtype; COV check passes after normalization.
```

### Incorrect
```markdown
## Task 3: Merge datasets — COMPLETE
# No deviation or reusable-fact report; the orchestrator cannot preserve what changed.
```
