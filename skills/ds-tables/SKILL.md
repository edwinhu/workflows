---
name: ds-tables
version: 1.0
description: "Use when building a publication-quality table in Python — 'regression table', 'results table', 'summary statistics table', 'etable', 'coefplot', 'great_tables', 'GT', 'gt table', 'format a table for the paper', 'export table to LaTeX/HTML', significance stars, spanners, or column formatting for a table headed into a paper, slide deck, or notebook."
user-invocable: true
---

## Contents

- [Which Tool](#which-tool)
- [Table Enforcement](#table-enforcement)
- [Quick Start](#quick-start)
- [Additional Resources](#additional-resources)

# Publication Tables in Python

Two libraries, one stack: `pyfixest.etable()` builds regression tables and
renders them *through* `great_tables`, so anything `etable()` returns can be
further styled with `GT` methods. Both render natively in marimo and Jupyter.

## Which Tool

| Building | Use | Reference |
|---|---|---|
| Regression results (coefficients, SEs, stars, FE panel) | `pf.etable([fit1, fit2])` | `references/pyfixest-tables.md` |
| Summary stats, descriptives, any DataFrame | `GT(df)` method chain | `references/great-tables.md` |
| Coefficient / event-study plot | `pf.coefplot()`, `pf.iplot()` | `references/pyfixest-tables.md` |
| LaTeX or HTML for a manuscript | `etable(..., type="tex" \| "html", file_name=...)` | `references/pyfixest-tables.md` |

## Table Enforcement

### IRON LAW: NO TABLE CLAIM WITHOUT RENDERING IT

A table that "looks right" in code is not a table. Before claiming one is done:

1. **RENDER** it — display the `GT` object, or write the tex/html file
2. **READ** the rendered output (in a notebook: look at it; for tex/html: read the file)
3. **VERIFY** the numbers against the source fit or DataFrame
4. **VERIFY** the labels, stars, and notes say what the caller thinks they say
5. **CLAIM** done only after the render is inspected

Handing over an unrendered table is NOT HELPFUL — the user pastes it into a
paper and discovers the stars are missing at submission time.

### Table Facts

- The **default** `etable()` prints stars (`1.873***`) — but the moment you pass `coef_fmt` yourself, stars come only from a `*` token in it. `coef_fmt="b \n (se)"` silently drops the stars you had for free; `"b* \n (se)"` keeps them. Verified on pyfixest 0.60.0: default → `1.873***`, explicit `"b \n (se)"` → `1.873`. `signif_code` only sets the thresholds, never whether stars render.
- `keep` / `drop` take **regex**, not names. `keep="x1"` also matches `x10` and `log_x1`; use `r"^x1$"` or `exact_match=True`.
- pyfixest drops singleton fixed-effect groups by default and prints a warning, not an error — the **observation count** silently differs from the same spec elsewhere unless you read the warning.
- `etable()` returns a `great_tables` `GT` object when `type="gt"` (the default). Reach for the GT method chain for anything etable doesn't parameterize instead of post-processing strings.
- `fmt_*` methods take `columns=` and `rows=`; omitting both applies the format to the whole table, which is rarely what a mixed-type table wants.

### Red Flags — STOP If About To:

- Report a regression table as final without having rendered and read it → STOP. Unrendered is unverified.
- Write a custom `coef_fmt` without a `*` token → STOP. You just turned off the stars the default gave you; `signif_code` will not bring them back.
- Hand-edit LaTeX that `etable()` produced → STOP. Round-trip the change through `etable()`/`GT` parameters, or the next re-run silently reverts it.
- Retype numbers from a fit into a table by hand → STOP. Every hand-typed number is an unverified claim; pass the fit objects.

## Quick Start

```python
import pyfixest as pf

fit1 = pf.feols("y ~ x1 + x2 | fe1", data=df, vcov={"CRV1": "cluster_var"})
fit2 = pf.feols("y ~ x1 + x2 | fe1 + fe2", data=df, vcov={"CRV1": "cluster_var"})

pf.etable(
    [fit1, fit2],
    coef_fmt="b* \n (se)",              # stars REQUIRE the * token
    labels={"x1": "Treatment"},
    notes="Standard errors clustered by firm.",
)
```

```python
from great_tables import GT, md

(GT(summary_df)
 .tab_header(title="Summary Statistics")
 .fmt_number(columns=["mean", "sd"], decimals=2)
 .cols_label(mean=md("**Mean**"))
 .tab_source_note("Sample: 1996-2024."))
```

## Additional Resources

### Reference Files

- **`references/pyfixest-tables.md`** — full `etable()` parameter reference: `coef_fmt` tokens, significance codes, keep/drop, labels, model headers, FE display, custom stats, `coefplot`/`iplot`, gotchas
- **`references/great-tables.md`** — `GT` constructor, method-chaining pattern, every `fmt_*` method, column management, headers/spanners, styling, export

### Related

- `/marimo`, `/jupytext` — where these tables render
- `ds-implement` — the DS phase that produces exhibits
