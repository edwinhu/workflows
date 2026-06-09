---
name: robustness-checks
description: Additional robustness beyond spec curves — placebo tests, IV, RDD, bootstrap, leave-one-out
applies-to: [ds-delegate]
---

## Rule

Specification curves (A2) are the primary robustness mechanism. A3 covers additional robustness checks that spec curves can't capture.

**Minimum standard:** Spec curve (A2) + at least 1 additional robustness check from A3 where applicable.

**If main result is sensitive to any spec curve choice OR any A3 check, flag as fragile in LEARNINGS.md.**

## What A3 Covers (Beyond Spec Curves)

| Robustness Type | What It Tests | Why Spec Curve Can't |
|----------------|---------------|---------------------|
| Placebo test | Randomize treatment, use pre-period, use unrelated outcome | Requires different data setup, not just different spec |
| Instrumental variables | Causal identification via exclusion restriction | Different estimation strategy, not combinatorial choice |
| Regression discontinuity | Bandwidth sensitivity, polynomial order | Specialized estimator with own diagnostics |
| Bootstrap / permutation inference | Finite-sample validity of SEs | Inference method, not specification choice |
| Leave-one-out influence | Single observation driving results | Diagnostics, not alternative spec |

## Rationale

**Why this exists** — Spec curves handle combinatorial specification choices. But some robustness checks require fundamentally different data setups or estimation strategies. A result that passes spec curves but fails a placebo test is not robust.

## Examples

### Correct
```python
# Spec curve passed (A2), now run placebo test (A3)
# Placebo: randomize treatment assignment
np.random.seed(42)
df["placebo_treatment"] = np.random.permutation(df["treatment"])
placebo_result = sm.OLS(df["outcome"], df[["placebo_treatment", "controls"]]).fit()
print(f"Placebo coefficient: {placebo_result.params['placebo_treatment']:.4f}")
print(f"Placebo p-value: {placebo_result.pvalues['placebo_treatment']:.4f}")
# Should be insignificant — if significant, real result is suspect
```

### Incorrect
```
# Only ran spec curve, no additional robustness
"Spec curve shows 85% of specifications significant → robust finding"
# But no placebo test, no leave-one-out, no check for influential observations
```
