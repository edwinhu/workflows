---
name: ds-analysis-constraints
description: Data-analysis constraints for ds analysis phases
applies-to: [ds, ds-fix, ds-plan, ds-implement, ds-review, ds-verify, ds-validate, ds-delegate]
---

# DS Analysis Constraints

Deterministic rules for data analysis tasks (statistical analysis, modeling, visualization). Each constraint can be verified by a script returning pass/fail. Self-contained files under `constraints/`.

**Loaded by:** ds-delegate for analysis-type tasks.

**Complements (not replaces):** `ds-common-constraints.md` — load both for analysis tasks.

**See also:** `ds-common-conventions.md` for judgment-based analysis guidance (V6: statistical validity, V7: p-hacking prevention, V8: sample selection, V9: deviation rules for analysis).

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| A1 | Robustness Checks | [constraints/ds-robustness-checks.md](constraints/ds-robustness-checks.md) | Beyond spec curves — placebo tests, IV, RDD, bootstrap, leave-one-out |
| A2 | Standard Error Spec | [constraints/ds-standard-error-spec.md](constraints/ds-standard-error-spec.md) | Match SE type to data structure — wrong SEs invalidate all inference |
| A3 | Visualization Integrity | [constraints/ds-visualization-integrity.md](constraints/ds-visualization-integrity.md) | Charts must not mislead — no truncated axes, dual-axis tricks, or 3D |
| A4 | Table-Figure Pairing | [constraints/ds-table-figure-pairing.md](constraints/ds-table-figure-pairing.md) | Every main result table needs a companion figure (the "Hendershott" rule) |

## Loading Guide

For analysis subagents, load all A1-A4. The most critical for preventing silent errors:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | A2 (SEs) | Wrong standard errors invalidate all inference |
| **For regressions** | A1 (robustness) | Prevent specification search |
| **For reporting** | A3 (visualization), A4 (table-figure pairing) | Prevent misleading output; ensure every table has a visual companion |
