---
name: ds-analysis-constraints
applies-to: [ds]
---

# DS Analysis Constraints

Deterministic rules for data analysis tasks (statistical analysis, modeling, visualization). Each constraint can be verified by a script returning pass/fail. Self-contained files under `${CLAUDE_PLUGIN_ROOT}/constraints/`.

**Complements (not replaces):** `${CLAUDE_PLUGIN_ROOT}/skills/ds/rules/ds-common-constraints.md` — load both for analysis tasks.

**See also:** `${CLAUDE_PLUGIN_ROOT}/skills/ds/rules/ds-common-conventions.md` for judgment-based analysis guidance (V6: statistical validity, V7: p-hacking prevention, V8: sample selection, V9: deviation rules for analysis).

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| A1 | Robustness Checks | [ds-robustness-menu.md](${CLAUDE_PLUGIN_ROOT}/rules/ds-robustness-menu.md) | Beyond spec curves — placebo tests, IV, RDD, bootstrap, leave-one-out |
| A2 | Standard Error Spec | [ds-se-matching.md](${CLAUDE_PLUGIN_ROOT}/rules/ds-se-matching.md) | Match SE type to data structure — wrong SEs invalidate all inference |
| A3 | Visualization Integrity | [ds-misleading-charts.md](${CLAUDE_PLUGIN_ROOT}/rules/ds-misleading-charts.md) | Charts must not mislead — no truncated axes, dual-axis tricks, or 3D |
| A4 | Table-Figure Pairing | [ds-companion-figures.md](${CLAUDE_PLUGIN_ROOT}/rules/ds-companion-figures.md) | Every main result table needs a companion figure (the "Hendershott" rule) |
| A5 | Chart Typography | [ds-chart-type-system.md](${CLAUDE_PLUGIN_ROOT}/rules/ds-chart-type-system.md) | Charts inherit the host document's type and palette — one registered theme, never per-chart styling |
| A6 | Chart Colour | [ds-chart-palette-choice.md](${CLAUDE_PLUGIN_ROOT}/rules/ds-chart-palette-choice.md) | Scheme matches the variable — categorical vs ramp, one reserved accent, grey for absence |

## Loading Guide

For analysis tasks, load all A1-A6. The most critical for preventing silent errors:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | A2 (SEs) | Wrong standard errors invalidate all inference |
| **For regressions** | A1 (robustness) | Prevent specification search |
| **For reporting** | A3 (visualization), A4 (table-figure pairing) | Prevent misleading output; ensure every table has a visual companion |
