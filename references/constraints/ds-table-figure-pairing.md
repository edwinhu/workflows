---
name: table-figure-pairing
description: Every main result table must have a companion figure that tells the same story visually (the "Hendershott" rule)
applies-to: [ds-delegate]
---

## Rule

Every main result table (regression output, summary statistics for key findings, cross-tabulations that support a claim) MUST be accompanied by a figure that conveys the same finding visually. The figure is not decoration --- it is an independent channel for the reader to verify the table's story.

**What counts as a "main result table":**
- Regression coefficient tables (OLS, IV, panel, logit, etc.)
- Difference-in-differences estimates
- Summary statistics that ARE the finding (not just sample description)
- Cross-tabulations or pivot tables that support a claim

**What does NOT require a companion figure:**
- Descriptive sample statistics (N, mean, SD of control variables)
- Data quality diagnostics (null counts, merge rates)
- Intermediate pipeline outputs

**Figure must match the table's story:**

| Table Shows | Figure Should Show |
|-------------|-------------------|
| Regression coefficients across specs | Coefficient plot with confidence intervals |
| Treatment effects over time | Event-study plot |
| DiD estimates | Parallel trends + treatment effect plot |
| Distribution differences across groups | Overlaid density plots or box plots |
| Cross-sectional variation | Scatter plot, binned scatter, or heatmap |
| Time-series results | Time-series line plot with confidence bands |

## Rationale

**Why this exists** --- A table can hide its story in a wall of numbers. A figure makes patterns, magnitudes, and anomalies immediately visible. If the figure tells a different story than the table, something is wrong with the analysis. The pairing is a built-in robustness check: table and figure must agree, or the author must explain why they don't.

Named for Terrence Hendershott, who insists that every table deserves a figure.

**Preferred tools:**
- **Python:** `great_tables` for tables, `pyobsplot` for figures. Matplotlib/seaborn are acceptable fallbacks.
- **R:** `gt` for tables, `ggplot2` for figures.

## Examples

### Correct
```python
from great_tables import GT
from pyobsplot import Plot

# Table: regression results via great_tables
coef_df = pd.DataFrame({
    "spec": ["Baseline", "+ Controls", "+ FE"],
    "coef": [m.params["treatment"] for m in [m1, m2, m3]],
    "se": [m.bse["treatment"] for m in [m1, m2, m3]],
    "ci_lo": [m.conf_int().loc["treatment", 0] for m in [m1, m2, m3]],
    "ci_hi": [m.conf_int().loc["treatment", 1] for m in [m1, m2, m3]],
})
table = (
    GT(coef_df)
    .tab_header(title="Treatment Effects Across Specifications")
    .fmt_number(columns=["coef", "se", "ci_lo", "ci_hi"], decimals=3)
)
table.save(output / "reg_results.html")

# Companion figure: coefficient plot via pyobsplot
Plot.plot({
    "marks": [
        Plot.ruleY([0], {"stroke": "gray", "strokeDasharray": "4"}),
        Plot.dot(coef_df, {"x": "spec", "y": "coef"}),
        Plot.ruleX(coef_df, {"x": "spec", "y1": "ci_lo", "y2": "ci_hi"}),
    ],
    "y": {"label": "Treatment Effect"},
})
```

### Incorrect
```python
# Table only --- no companion figure
table = GT(coef_df).tab_header(title="Treatment Effects")
table.save(output / "reg_results.html")
# "The reader can see the coefficients in the table"
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The table is self-explanatory" | Tables are never self-explanatory to a skimmer. Figures catch the eye; tables require effort. | Make the figure. It takes 5 minutes. |
| "There's no natural visual for this result" | There is always a visual. Coefficients get dot plots. Distributions get densities. Time variation gets line plots. | Pick the right chart type from the table above. |
| "The figure would be redundant" | Redundancy is the point. Two channels, one story. If they disagree, you found a bug. | Redundancy is a feature, not a cost. |
| "I'll add figures later in the polishing phase" | Later never comes. The table ships without its figure and the reader misses the story. | Create table and figure together, in the same script. |
| "It's just a robustness table, not a main result" | If it's important enough to include, it's important enough to visualize. | Make the figure. Robustness deserves visual evidence too. |

## Red Flags

- **Writing a regression table without starting the companion figure** --- STOP. Write both in the same code block.
- **"I'll come back and add the figure"** --- STOP. You won't. Do it now.
- **Saving a .tex or .csv table with no .pdf/.png in the same output directory** --- STOP. The pair must ship together.
- **A figure that doesn't match the table's specification** --- STOP. If the table has 3 columns (baseline, +controls, +FE), the coefficient plot must have 3 points.
