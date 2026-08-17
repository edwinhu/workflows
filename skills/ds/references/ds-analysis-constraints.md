---
name: ds-analysis-constraints
description: Data-analysis constraints for ds analysis work
applies-to: [ds]
---

# DS Analysis Constraints

Deterministic rules for data analysis tasks (statistical analysis, modeling, visualization). Each constraint can be verified by a script returning pass/fail. Self-contained files under `${CLAUDE_PLUGIN_ROOT}/references/constraints/`.

**Complements (not replaces):** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-constraints.md` — load both for analysis tasks.

**See also:** `${CLAUDE_PLUGIN_ROOT}/skills/ds/references/ds-common-conventions.md` for judgment-based analysis guidance (V6: statistical validity, V7: p-hacking prevention, V8: sample selection, V9: deviation rules for analysis).

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| A1 | Robustness Checks | [ds-robustness-checks.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-robustness-checks.md) | Beyond spec curves — placebo tests, IV, RDD, bootstrap, leave-one-out |
| A2 | Standard Error Spec | [ds-standard-error-spec.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-standard-error-spec.md) | Match SE type to data structure — wrong SEs invalidate all inference |
| A3 | Visualization Integrity | [ds-visualization-integrity.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-visualization-integrity.md) | Charts must not mislead — no truncated axes, dual-axis tricks, or 3D |
| A4 | Table-Figure Pairing | [ds-table-figure-pairing.md](${CLAUDE_PLUGIN_ROOT}/references/constraints/ds-table-figure-pairing.md) | Every main result table needs a companion figure (the "Hendershott" rule) |

## Loading Guide

For analysis tasks, load all A1-A4. The most critical for preventing silent errors:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | A2 (SEs) | Wrong standard errors invalidate all inference |
| **For regressions** | A1 (robustness) | Prevent specification search |
| **For reporting** | A3 (visualization), A4 (table-figure pairing) | Prevent misleading output; ensure every table has a visual companion |
