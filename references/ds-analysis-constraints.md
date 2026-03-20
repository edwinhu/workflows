# DS Analysis Constraints

Role-specific behavioral rules for data analysis tasks (statistical analysis, modeling, visualization). Each constraint is self-contained in its own file under `constraints/`.

**Loaded by:** ds-delegate for analysis-type tasks.

**Complements (not replaces):** `ds-common-constraints.md` — load both for analysis tasks.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| A1 | Statistical Validity | [constraints/ds-statistical-validity.md](constraints/ds-statistical-validity.md) | Every statistical claim must have correct test with documented assumptions |
| A2 | P-Hacking Prevention | [constraints/ds-p-hacking-prevention.md](constraints/ds-p-hacking-prevention.md) | Specification locked BEFORE regressions — includes spec curve protocol |
| A3 | Robustness Checks | [constraints/ds-robustness-checks.md](constraints/ds-robustness-checks.md) | Beyond spec curves — placebo tests, IV, RDD, bootstrap, leave-one-out |
| A4 | Sample Selection | [constraints/ds-sample-selection.md](constraints/ds-sample-selection.md) | Every sample restriction documented and justified — flag >20% drops |
| A5 | Standard Error Spec | [constraints/ds-standard-error-spec.md](constraints/ds-standard-error-spec.md) | Match SE type to data structure — wrong SEs invalidate all inference |
| A6 | Visualization Integrity | [constraints/ds-visualization-integrity.md](constraints/ds-visualization-integrity.md) | Charts must not mislead — no truncated axes, dual-axis tricks, or 3D |
| A7 | Deviation Rules (Analysis) | [constraints/ds-deviation-rules-analysis.md](constraints/ds-deviation-rules-analysis.md) | R4 gate for methodology changes after seeing results |

## Loading Guide

For analysis subagents, load all A1-A7. The most critical for preventing silent errors:

| Priority | Constraints | Why |
|----------|-------------|-----|
| **Always** | A1 (validity), A2 (p-hacking), A5 (SEs) | These prevent invalid inference |
| **For regressions** | A2 (spec curve), A3 (robustness), A7 (deviation rules) | Prevent specification search |
| **For reporting** | A4 (sample selection), A6 (visualization) | Prevent misleading output |
