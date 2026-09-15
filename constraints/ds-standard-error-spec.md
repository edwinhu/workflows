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

## Facts

- The correct clustering level is the level of treatment assignment; when uncertain between levels, the higher level is the conservative choice. An undocumented clustering choice is an unjustified one — record the level and the reason in the output.
- "Clustering doesn't change the main result" is unknowable before running it — the claim is only honest after the comparison is shown.
