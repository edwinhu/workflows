---
name: p-hacking-prevention
description: Specification must be locked BEFORE running regressions — post-hoc specification search invalidates inference
applies-to: [ds-delegate]
---

## Rule

The specification must be locked BEFORE running regressions. Post-hoc specification search invalidates inference. Changes to the specification after seeing results are R4 (methodology change — STOP and present to user).

**Iron Law:** The specification is written in PLAN.md BEFORE the first regression runs.

### Specification Curve Analysis (Structural P-Hacking Defense)

Instead of running one "preferred" specification, **run ALL theoretically defensible specifications and show the full distribution** (Simonsohn, Simmons & Nelson, 2020).

**The 3-step protocol:**
1. **Define the specification space in PLAN.md** — enumerate all reasonable combinations of: dependent variables, independent variables, controls, sample filters, estimators, transformations
2. **Run all combinations** — every permutation gets estimated
3. **Visualize + joint inference** — specification curve plot shows all estimates ranked

**Tools:**

| Language | Package | Usage |
|----------|---------|-------|
| R | `specr` (CRAN) | **Preferred.** Mature, v1.0+ with inference, variance decomposition |
| Python | `specification_curve` | Alternative for Python-only projects |
| Stata | `speccurve` | For Stata pipelines |

**`specr` workflow (R):**
```r
library(specr)
specs <- setup(
  data = df,
  x = c("treatment", "treatment_alt"),
  y = c("outcome1", "outcome2"),
  model = c("lm"),
  controls = c("control1", "control2"),
  subsets = list(period = "sample_group")
)
results <- specr(specs)
plot(results, type = "curve")
plot(results, type = "boxplot")
summary(results, type = "curve")
```

**Interpretation:**

| Pattern | Interpretation | Action |
|---------|---------------|--------|
| >80% of specs show same sign + significance | Robust finding | Report with confidence |
| 50-80% same sign, mixed significance | Fragile — sensitive to choices | Report with caveats |
| <50% same sign | Not robust | Flag as fragile, do NOT report as finding |
| One analytical choice flips results | That choice is the story | Report the choice sensitivity |

**When to run spec curves:** EVERY main regression result, before reporting any causal claim, when choosing between alternative variable definitions.

**When NOT appropriate:** Pure descriptive statistics, mechanical data transformations, exploratory data analysis.

## Rationale

**Why this exists** — A single regression is one path through a garden of forking paths. Reporting it as "the result" without showing the specification curve is like reporting one coin flip as evidence.

## Examples

### Correct
```
# In PLAN.md (BEFORE running):
## Specification
- DV: log_returns, raw_returns
- IV: treatment_dummy
- Controls: size, btm, momentum
- Sample: full, post-2010, excluding financials
- Estimator: OLS with firm-clustered SEs
```

### Incorrect
```
# Running regression, seeing insignificant result, then:
"Let me try adding industry fixed effects..."
"What if we use log returns instead?"
"Results are stronger if we drop pre-2008..."
```
