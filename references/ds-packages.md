# Recommended Data Science Packages

Packages installed by default in new empirical projects (`new_project.sh --empirical`) or commonly added for analysis work.

## Core Data Stack

| Package | Purpose | Install |
|---------|---------|---------|
| `pandas` | Tabular data (legacy, wide ecosystem) | pixi |
| `polars` | Fast tabular data (preferred for new work) | pixi |
| `pyarrow` | Columnar memory format, parquet I/O | pixi |
| `duckdb` | In-process SQL analytics | pixi |

## Tables & Visualization

| Package | Purpose | Install |
|---------|---------|---------|
| `great_tables` | Publication-quality tables (Python port of R's `gt`) | pixi |
| `plotnine` | Grammar of graphics (ggplot2 for Python) | pixi |
| `matplotlib` | Low-level plotting | pixi |

## Regression & Econometrics

| Package | Purpose | Install |
|---------|---------|---------|
| `pyfixest` | Fast fixed effects estimation with `etable()` → great_tables output | pypi |
| `linearmodels` | Panel data, IV, system estimation | pixi |
| `statsmodels` | Classical statistics, OLS, time series | pixi |

## Notebooks

| Package | Purpose | Install |
|---------|---------|---------|
| `marimo` | Reactive Python notebooks (preferred) | pixi |
| `jupyter` | Classic notebooks | pixi |
| `ipython` | Enhanced Python REPL | pixi |

## R Packages (via pixi)

| Package | Purpose |
|---------|---------|
| `r-gt` | Publication-quality tables |
| `r-essentials` | Base R package bundle |

## Notes

- `pyfixest.etable()` renders regression tables as `great_tables.GT` objects — they display natively in marimo and Jupyter
- Use `coef_fmt="b* [t]\n(se)"` for academic-style output with significance stars
- `great_tables` works with both pandas and polars DataFrames
- For WRDS access, add `wrds` and `psycopg2`
