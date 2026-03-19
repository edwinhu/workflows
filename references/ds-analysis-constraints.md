# DS Analysis Constraints

Role-specific enforcement for data analysis tasks (statistical analysis, modeling, visualization). Loaded by ds-analyst agent and ds-delegate for analysis-type tasks.

**Complements (not replaces):** `ds-common-constraints.md` — load both for analysis tasks.

---

## A1: Statistical Validity

Every statistical claim must be supported by the correct test with documented assumptions.

| Claim Type | Required Evidence |
|-----------|-------------------|
| "X affects Y" | Regression with appropriate controls, correct SEs, significance level stated |
| "Groups differ" | Appropriate test (t-test, Wilcoxon, ANOVA) with assumption checks |
| "Trend exists" | Time series test with stationarity check, not just visual inspection |
| "Correlation" | Pearson/Spearman with confidence interval, not just point estimate |
| "Model fits well" | Out-of-sample performance, not just in-sample R² |

**Drive-Aligned Framing:** Reporting a statistically invalid result is worse than reporting nothing. The user makes decisions based on your numbers. Wrong numbers create wrong decisions.

---

## A2: P-Hacking Prevention

The specification must be locked BEFORE running regressions. Post-hoc specification search invalidates inference.

| Anti-Pattern | What's Wrong | Fix |
|-------------|-------------|-----|
| Running 20 specs, reporting the one that's significant | Multiple testing without correction | Pre-register spec in PLAN.md, report ALL results |
| Adding controls until p < 0.05 | Specification search | Lock controls in PLAN.md before running |
| Dropping outliers until results "improve" | Data snooping | Define outlier criteria in PLAN.md before analysis |
| Trying log/level/sqrt transforms until significant | Functional form search | Justify transformation choice from theory, not results |
| Subsetting to periods where effect is strongest | Cherry-picking sample | Full sample first, subsamples as robustness |

**Test:** Can you justify every specification choice from PLAN.md without seeing the results? If not, it's p-hacking.

**Iron Law:** The specification is written in PLAN.md BEFORE the first regression runs. Changes to the specification after seeing results are R4 (methodology change — STOP and present to user).

### Specification Curve Analysis (Structural P-Hacking Defense)

Instead of running one "preferred" specification and hoping it's robust, **run ALL theoretically defensible specifications and show the full distribution** (Simonsohn, Simmons & Nelson, 2020). If your finding only appears in 3 of 200 reasonable specifications, it's not robust — it's cherry-picked.

**The 3-step protocol:**
1. **Define the specification space in PLAN.md** — enumerate all reasonable combinations of: dependent variables, independent variables, controls, sample filters, estimators, transformations
2. **Run all combinations** — every permutation gets estimated
3. **Visualize + joint inference** — specification curve plot shows all estimates ranked, with indicator panels showing which analytical choices drive variation

**Tools:**

| Language | Package | Usage |
|----------|---------|-------|
| R | `specr` (CRAN) | **Preferred.** Mature, v1.0+ with inference, variance decomposition |
| Python | `specification_curve` | Alternative for Python-only projects |
| Stata | `speccurve` | For Stata pipelines |

**`specr` workflow (R):**
```r
library(specr)

# 1. Define the specification space
specs <- setup(
  data = df,
  x = c("treatment", "treatment_alt"),    # alternative IVs
  y = c("outcome1", "outcome2"),          # alternative DVs
  model = c("lm"),                        # estimators
  controls = c("control1", "control2"),   # controls to include/exclude
  subsets = list(period = "sample_group")  # sample restrictions
)

# 2. Run all specifications
results <- specr(specs)

# 3. Visualize and interpret
plot(results, type = "curve")     # specification curve
plot(results, type = "boxplot")   # estimates by analytical choice
summary(results, type = "curve")  # variance decomposition
```

**Interpretation guidelines:**

| Pattern | Interpretation | Action |
|---------|---------------|--------|
| >80% of specs show same sign + significance | Robust finding | Report with confidence |
| 50-80% same sign, mixed significance | Fragile — sensitive to choices | Report with caveats, identify which choices matter |
| <50% same sign | Not robust | Flag as fragile in LEARNINGS.md, do NOT report as a finding |
| One analytical choice flips results | That choice is the story | Report the choice sensitivity, not just the "preferred" result |

**When to run spec curves:**
- EVERY main regression result (not optional)
- Before reporting any causal claim
- When choosing between alternative variable definitions

**When spec curves are NOT appropriate:**
- Pure descriptive statistics (means, distributions)
- Mechanical data transformations (merges, aggregations)
- Exploratory data analysis (EDA phase)

**Drive-Aligned Framing:** A single regression is one path through a garden of forking paths. Reporting it as "the result" without showing the specification curve is like reporting one coin flip as evidence. The spec curve shows the full garden — and if your finding only exists on one path, the user needs to know that before making decisions.

---

## A3: Robustness Checks

Specification curves (A2) are the primary robustness mechanism. A3 covers additional robustness checks that spec curves don't capture.

**Spec curves handle:** alternative variables, controls, sample filters, estimators, transformations — all combinatorial choices.

**A3 handles what spec curves can't:**

| Robustness Type | What It Tests | Why Spec Curve Can't |
|----------------|---------------|---------------------|
| Placebo test | Randomize treatment, use pre-period, use unrelated outcome | Requires different data setup, not just different spec |
| Instrumental variables | Causal identification via exclusion restriction | Different estimation strategy, not combinatorial choice |
| Regression discontinuity | Bandwidth sensitivity, polynomial order | Specialized estimator with own diagnostics |
| Bootstrap / permutation inference | Finite-sample validity of SEs | Inference method, not specification choice |
| Leave-one-out influence | Single observation driving results | Diagnostics, not alternative spec |

**Minimum standard:** Spec curve (A2) + at least 1 additional robustness check from A3 where applicable.

**If main result is sensitive to any spec curve choice OR any A3 check, flag as fragile in LEARNINGS.md.**

---

## A4: Sample Selection

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
## Sample Construction (in LEARNINGS.md)

Starting universe: N observations
- Drop [reason]: -X obs (Y%)
- Drop [reason]: -X obs (Y%)
- Final sample: N observations (Z% of starting)
```

**If total dropped > 20% of starting universe, flag as potential selection bias in LEARNINGS.md.**

---

## A5: Standard Error Specification

Wrong standard errors invalidate every t-stat and p-value. This is the most common silent error in empirical work.

| Data Structure | Correct SE |
|---------------|-----------|
| Panel (firm-year) | Clustered by firm (at minimum) |
| Cross-section with groups | Clustered by group or HC robust |
| Time series | HAC (Newey-West) |
| Diff-in-diff | Clustered by treatment unit |
| Multi-way clustering | Two-way (firm + time) |

**Anti-patterns:**
- Default OLS SEs on panel data (too small → false positives)
- Clustering at wrong level (e.g., year-level clustering with firm-level treatment)
- No clustering justification in output

**Drive-Aligned Framing:** Reporting results with wrong standard errors is reporting fiction. Every t-stat is wrong. Every confidence interval is wrong. The user's conclusions are built on sand.

---

## A6: Visualization Integrity

Charts must not mislead. Common visualization errors that look professional but lie:

| Anti-Pattern | What's Wrong | Fix |
|-------------|-------------|-----|
| Truncated y-axis | Exaggerates small differences | Start at 0 or clearly label break |
| Dual y-axes with different scales | Suggests correlation where none exists | Separate panels or normalize |
| Pie charts for comparison | Human perception of angles is poor | Bar chart |
| 3D charts | Depth distorts proportions | 2D always |
| Smoothed trend hiding volatility | Hides variance that matters | Show raw + trend, or confidence band |
| Cherry-picked time window | Period selection bias | Show full available period |

---

## A7: Deviation Rules (Analysis)

| Rule | Trigger | Action |
|------|---------|--------|
| R1: Bug | Code error, wrong formula, transposed variables | Auto-fix → re-run → verify → track |
| R2: Missing | No robustness checks, no SE justification, no sample documentation | Add → verify → track |
| R3: Blocking | Package not installed, data not accessible, memory error | Fix → verify → track |
| R4: Methodology | Switching estimator, changing sample period, adding/removing controls AFTER seeing results, changing dependent variable | STOP → present to user |

**R4 is the critical gate for analysis.** Any specification change after seeing results is methodology drift. The user must approve it explicitly. "I changed the controls because results were insignificant" is p-hacking, not analysis.
