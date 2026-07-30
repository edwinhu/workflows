---
name: data-quality-checks
description: Canonical DQ1-DQ6, COV, M1, R1 check definitions — load from ds-checks.md, never inline
applies-to: [ds-fix, ds-implement, ds-delegate]
---

## Rule

All skills that evaluate data quality MUST Read() the canonical checks file at `skills/ds-implement/references/ds-checks.md` to ensure identical DQ1-DQ6, COV, M1, R1 definitions. Do not inline check definitions — they will drift.

## Rationale

**Why this exists** — When check definitions are inlined in multiple technical roles, each version drifts independently. The canonical file is the single source of truth.

## Examples

### Correct
```
Read `${CLAUDE_SKILL_DIR}/../../skills/ds-implement/references/ds-checks.md`
# Now DQ1-DQ6, M1, R1 are loaded from canonical source
```

### Incorrect
```
# Inlining check definitions in the skill
DQ1: Check for nulls in key columns
DQ2: Check for duplicates
# These will drift from the canonical definitions
```
