---
name: standard-error-specification
description: Wrong SEs invalidate every t-stat and p-value — match SE type to data structure
applies-to: [ds-delegate]
---

## Rule

Wrong standard errors invalidate every t-stat and p-value. This is the most common silent error in empirical work. Match SE specification to data structure.

| Data Structure | Correct SE |
|---------------|-----------|
| Panel (firm-year) | Clustered by firm (at minimum) |
| Cross-section with groups | Clustered by group or HC robust |
| Time series | HAC (Newey-West) |
| Diff-in-diff | Clustered by treatment unit |
| Multi-way clustering | Two-way (firm + time) |

## Rationale

**Why this exists** — Default OLS standard errors assume i.i.d. errors. Panel data, grouped data, and time series violate this assumption. Using default SEs produces standard errors that are too small → false positives → wrong conclusions.

## Examples

### Correct
```python
# Panel data: cluster by firm
import statsmodels.api as sm
model = sm.OLS(y, X).fit(cov_type='cluster', cov_kwds={'groups': df['firm_id']})
print(model.summary())  # Clustered SEs shown
```

### Incorrect
```python
# Panel data with default (wrong) SEs
model = sm.OLS(y, X).fit()  # Default SEs — too small for panel data
# Every t-stat is inflated, every p-value is too small
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Default SEs are fine for a quick look" | Wrong SEs give wrong inference. There's no "quick look" that's allowed to be wrong. | Use correct SEs from the start. |
| "Clustering doesn't change the main result" | Sometimes it does. You won't know until you try. | Always cluster appropriately, then compare. |
| "I'm not sure what level to cluster at" | Cluster at the level of treatment assignment. When uncertain, cluster at the higher level. | Document your clustering choice and justification. |

## Red Flags

- **Default OLS SEs on panel data** → STOP. Cluster by firm at minimum.
- **No clustering justification in output** → STOP. Document why this clustering level.
- **"SEs don't matter much here"** → STOP. Wrong SEs invalidate ALL inference.

## Drive-Aligned Framing

Reporting results with wrong standard errors is reporting fiction. Every t-stat is wrong. Every confidence interval is wrong. The user's conclusions are built on sand.
