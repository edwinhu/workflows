---
name: statistical-validity
description: Every statistical claim must have correct test with documented assumptions
applies-to: [ds-delegate]
---

## Rule

Every statistical claim must be supported by the correct test with documented assumptions.

| Claim Type | Required Evidence |
|-----------|-------------------|
| "X affects Y" | Regression with appropriate controls, correct SEs, significance level stated |
| "Groups differ" | Appropriate test (t-test, Wilcoxon, ANOVA) with assumption checks |
| "Trend exists" | Time series test with stationarity check, not just visual inspection |
| "Correlation" | Pearson/Spearman with confidence interval, not just point estimate |
| "Model fits well" | Out-of-sample performance, not just in-sample R² |

## Rationale

**Why this exists** — Reporting a statistically invalid result is worse than reporting nothing. The user makes decisions based on your numbers. Wrong numbers create wrong decisions.

## Examples

### Correct
```python
# Appropriate test with documented assumptions
from scipy import stats
# Check normality assumption
stat, p = stats.shapiro(group_a)
print(f"Normality test: W={stat:.4f}, p={p:.4f}")
# If normal, use t-test; if not, use Wilcoxon
if p > 0.05:
    t, p_val = stats.ttest_ind(group_a, group_b)
else:
    t, p_val = stats.mannwhitneyu(group_a, group_b)
print(f"Test result: stat={t:.4f}, p={p_val:.4f}")
```

### Incorrect
```python
# No assumption checks, wrong test
t, p = stats.ttest_ind(group_a, group_b)  # Assumes normality without checking
print(f"Groups differ: p={p:.4f}")  # Claims difference without effect size or CI
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The test is standard for this data" | Standard doesn't mean correct. Check assumptions. | Document and verify assumptions before running |
| "The p-value is very small, assumptions don't matter" | Grossly violated assumptions invalidate even small p-values | Check assumptions regardless of p-value |
| "I'll add assumption checks later" | Later never comes. The result is already reported. | Check assumptions BEFORE running the test |

## Red Flags

- **"The result is significant"** → STOP. Did you check test assumptions? Correct SEs? Effect size?
- **"The model fits well (R²=0.95)"** → STOP. In-sample only? Check out-of-sample.
- **"Groups clearly differ"** → STOP. By visual inspection? Run the appropriate test.

## Drive-Aligned Framing

Reporting a statistically invalid result is worse than reporting nothing. The user makes decisions based on your numbers. Wrong numbers create wrong decisions.
