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

---

## A3: Robustness Checks

Every main result requires at least 3 robustness checks. Results that don't survive robustness are fragile, not findings.

| Robustness Type | What It Tests |
|----------------|---------------|
| Alternative sample | Drop first/last year, exclude small firms, different filters |
| Alternative specification | Add/remove controls, different FE structure |
| Alternative estimator | OLS vs IV, logit vs probit, Poisson vs negative binomial |
| Alternative variable definition | Different winsorization, alternative measures |
| Placebo test | Randomize treatment, use pre-period, use unrelated outcome |

**Minimum standard:** Main result + 3 robustness checks. If main result is sensitive to any single robustness check, flag as fragile in LEARNINGS.md.

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
