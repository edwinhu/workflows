---
name: ds-tables
version: 1.0
description: "Use when building a publication-quality table in Python — 'regression table', 'results table', 'summary statistics table', 'etable', 'coefplot', 'great_tables', 'GT', 'gt table', 'format a table for the paper', 'export table to LaTeX/HTML', significance stars, spanners, or column formatting for a table headed into a paper, slide deck, or notebook."
user-invocable: true
---

## Contents

- [Which Tool](#which-tool)
- [House Style](#house-style)
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

## House Style

The same rules as `ds-figures`, applied to cells instead of axes.

| | Rule | Why |
|---|---|---|
| **Labels** | Every row label, column header, spanner, and cell value is **prose, never an identifier**. Row labels are **Capitalized**; column headers and spanners are **Title Case** | The reader never saw your DataFrame. `glass_lewis` is not a scenario, **Glass Lewis** is; `log_mktcap` is not a covariate, **Log Market Cap** is. A table of variable names is a `df.describe()` dump, not an exhibit. |
| **Type** | **Serif** throughout, matching the figures and the body text | A table set in the library's default sans sits next to serif figures and reads as a different document. |
| **Numbering** | Main exhibits **Table 1 … Table N**, consecutive in order of first mention. Appendix exhibits restart as **Table A1 … Table AN**, numbered independently of the figures | Numbers are the reader's only address for an exhibit. Tables and figures each get their own sequence — "Table 3" and "Figure 3" coexist. |

`etable()` takes the relabelling directly — there is no reason to ship raw names:

```python
LABELS = {
    "glass_lewis": "Glass Lewis",
    "iss_rec": "ISS Recommendation",
    "log_mktcap": "Log Market Cap",
    "support_rate": "Shareholder Support Rate",
}
pf.etable([fit1, fit2], labels=LABELS, coef_fmt="b* \n (se)")
```

For a `GT` table, rename the row-label column *and* its values before construction
— `cols_label()` only fixes headers, never the row labels sitting in the body.

## Table Enforcement

### IRON LAW: NO TABLE CLAIM WITHOUT RENDERING IT

A table that "looks right" in code is not a table. Before claiming one is done:

1. **RENDER** it — display the `GT` object, or write the tex/html file
2. **READ** the rendered output (in a notebook: look at it; for tex/html: read the file)
3. **VERIFY** the numbers against the source fit or DataFrame
4. **VERIFY** the labels, stars, and notes say what the caller thinks they say —
   no identifiers anywhere, row labels Capitalized, headers Title Case
5. **VERIFY** nothing is clipped or overflowing: no `…`-truncated label, no
   column running past the page or container width
6. **CLAIM** done only after the render is inspected

Handing over an unrendered table is NOT HELPFUL — the user pastes it into a
paper and discovers the stars are missing at submission time.

### Table Facts

- The **default** `etable()` prints stars (`1.873***`) — but the moment you pass `coef_fmt` yourself, stars come only from a `*` token in it. `coef_fmt="b \n (se)"` silently drops the stars you had for free; `"b* \n (se)"` keeps them. Verified on pyfixest 0.60.0: default → `1.873***`, explicit `"b \n (se)"` → `1.873`. `signif_code` only sets the thresholds, never whether stars render.
- `keep` / `drop` take **regex**, not names. `keep="x1"` also matches `x10` and `log_x1`; use `r"^x1$"` or `exact_match=True`.
- pyfixest drops singleton fixed-effect groups by default and prints a warning, not an error — the **observation count** silently differs from the same spec elsewhere unless you read the warning.
- `etable()` returns a `great_tables` `GT` object when `type="gt"` (the default). Reach for the GT method chain for anything etable doesn't parameterize instead of post-processing strings.
- `fmt_*` methods take `columns=` and `rows=`; omitting both applies the format to the whole table, which is rarely what a mixed-type table wants.
- **Unlabelled coefficients render as the raw variable name.** `etable()` prints whatever is in the formula, so `log_mktcap` and `glass_lewis` ship verbatim unless `labels=` covers them — and a name missing from the dict fails silently, printing the identifier rather than raising. Every table needs its `labels=` dict checked against the rendered output, not against the dict.
- **`cols_label()` does not touch row labels.** It renames column headers only; the row-label column's *values* come from the DataFrame, so identifiers there survive every styling call. Rename the values in the DataFrame before `GT()`.
- **`str.title()` is not Title Case for exhibit labels** — it yields "Log Market Cap By Iss Rec", capitalizing the preposition and destroying the acronym. Write the strings by hand in the labels dict.
- **A LaTeX table's width is not visible in the notebook render.** `type="gt"` fits its container and `type="tex"` overflows the text block — the same table that looks fine inline runs into the margin in the compiled PDF. Compile before claiming a tex table is done.
- **Tables and figures carry independent counters, and appendix tables restart at A1.** Continuing main numbering into the appendix, or sharing one counter with the figures, breaks every cross-reference in the text.

### Red Flags — STOP If About To:

- Report a regression table as final without having rendered and read it → STOP. Unrendered is unverified.
- Write a custom `coef_fmt` without a `*` token → STOP. You just turned off the stars the default gave you; `signif_code` will not bring them back.
- Hand-edit LaTeX that `etable()` produced → STOP. Round-trip the change through `etable()`/`GT` parameters, or the next re-run silently reverts it.
- Retype numbers from a fit into a table by hand → STOP. Every hand-typed number is an unverified claim; pass the fit objects.
- Ship a row label, column header, spanner, or cell value that is a column name or a code (`glass_lewis`, `log_mktcap`, `support_rate`) → STOP. The reader has never seen your schema. Map it to prose: "Glass Lewis", "Log Market Cap".
- Write row labels in lowercase, or headers in sentence case → STOP. Row labels are Capitalized, headers and spanners are Title Case.
- Call `.title()` to produce a header → STOP. It capitalizes prepositions and mangles acronyms; write the string.
- Number an appendix table in the main sequence, or share a counter with the figures → STOP. Appendix tables are A1…AN, and tables count separately from figures.
- Declare a `type="tex"` table done without compiling it → STOP. Overflow past the text block is invisible in the notebook render.

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
