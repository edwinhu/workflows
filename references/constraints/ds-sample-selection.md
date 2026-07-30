---
name: sample-selection
description: Every sample restriction must be documented and justified — undocumented restrictions are hidden assumptions
applies-to: [ds-delegate]
---

## Rule

Every sample restriction must be documented and justified. Undocumented restrictions are hidden assumptions.

| Sample Decision | Must Document |
|----------------|---------------|
| Time period | Why this start/end date? Data availability or theoretical? |
| Universe filter | Why exclude these firms/observations? |
| Missing data treatment | Drop, impute, or indicator? Why? |
| Outlier treatment | Winsorize at what level? Why that threshold? |
| Survivorship | Does sample require firms to exist for full period? |

**Pattern:**
```
## Sample Construction (in the implementation report)

Starting universe: N observations
- Drop [reason]: -X obs (Y%)
- Drop [reason]: -X obs (Y%)
- Final sample: N observations (Z% of starting)
```

**If total dropped > 20% of starting universe, flag as potential selection bias in the implementation report.**

## Rationale

**Why this exists** — Undocumented sample restrictions are hidden assumptions. Each restriction changes the population your results generalize to. Without documentation, the user doesn't know what they're actually analyzing.

## Examples

### Correct
```markdown
## Sample Construction
Starting universe: 50,000 firm-years (2000-2023)
- Drop missing returns: -2,500 (5.0%)
- Drop financials (SIC 6000-6999): -8,000 (16.0%)
- Drop micro-caps (< $10M mkt cap): -5,000 (10.0%)
- Final sample: 34,500 firm-years (69.0% of starting)
⚠️ Total dropped: 31% — potential selection bias flagged
```

### Incorrect
```python
df = df[df["year"] >= 2010]  # Why 2010? Not documented
df = df.dropna()  # How many rows dropped? Not logged
```
