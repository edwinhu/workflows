---
name: jupytext
description: This skill should be used when the user asks to "convert notebook to text", "use jupytext", "version control notebooks", "share data between kernels", "set up multi-kernel project", "pair notebooks with Python files", "sync ipynb and py files", or needs multi-kernel projects (Python/R/Stata/SAS) with version-control-friendly notebooks.
---

# Jupytext Skill

Jupytext converts Jupyter notebooks to/from text formats (.py, .R, .md), enabling version control and multi-kernel workflows.

## Core Concepts

### Percent Format (Recommended)

Use percent format (`py:percent`) for all projects:

```python
# %% [markdown]
# # Analysis Title

# %%
import pandas as pd
df = pd.read_csv("data.csv")

# %% tags=["parameters"]
input_file = "data.csv"
```

Cell markers: `# %%` for code, `# %% [markdown]` for markdown.

### Project Configuration

Create `jupytext.toml` in project root:

```toml
formats = "ipynb,py:percent"
notebook_metadata_filter = "-all"
cell_metadata_filter = "-all"
```

### Essential Commands

```bash
# Convert notebook to percent-format Python
jupytext --to py:percent notebook.ipynb

# Convert Python script to notebook
jupytext --to notebook script.py

# Set up pairing (keeps both in sync)
jupytext --set-formats ipynb,py:percent notebook.ipynb

# Sync paired files
jupytext --sync notebook.ipynb
```

## Multi-Kernel Data Sharing

Share data between Python/R/Stata/SAS via files:

| Route | Format | Write | Read |
|-------|--------|-------|------|
| Python -> R | Parquet | `df.to_parquet()` | `arrow::read_parquet()` |
| Python -> Stata | DTA | `df.to_stata()` | `use "file.dta"` |
| Any -> Any | CSV | Native | Native |
| SQL queries | DuckDB | Query parquet directly | Query parquet directly |

### Cross-Kernel Pipeline Pattern

```
Python (prep) -> Parquet -> R (stats) -> Parquet -> Python (report)
                    |
                    v
               Stata (.dta) -> Econometrics
```

## Workflow Integration

### Git Pre-commit Hook

Add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/mwouts/jupytext
    rev: v1.16.0
    hooks:
      - id: jupytext
        args: [--sync]
```

### Version Control Strategy

Option A: Commit only .py files (add `*.ipynb` to `.gitignore`)
Option B: Commit both formats (reviewers choose preference)

### Editor Integration

- **VS Code**: Install Jupytext extension for automatic sync
- **JupyterLab**: Right-click notebook -> "Pair Notebook"

## Project Structure

Standard multi-kernel project layout:

```
project/
├── jupytext.toml          # Project-wide settings
├── environment.yml        # Conda env with all kernels
├── notebooks/
│   ├── 01_python_prep.py  # Python percent format
│   ├── 02_r_analysis.R    # R percent format
│   └── 03_stata_models.do # Stata script
├── data/
│   ├── raw/
│   └── processed/         # Parquet/DTA interchange files
└── results/
```

## Kernel Specification

Specify kernel in file header:

```python
# ---
# jupyter:
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # Python Analysis
```

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Sync conflict | Delete .ipynb, regenerate from .py |
| Wrong kernel | Add kernelspec header to .py file |
| Metadata noise | Set `notebook_metadata_filter = "-all"` |
| Cell order lost | Use percent format (preserves structure) |

## Additional Resources

### Reference Files

Detailed patterns and configurations:

- **`references/formats.md`** - All format specifications (percent, light, sphinx, myst, rmd, quarto), cell metadata, configuration options
- **`references/kernels.md`** - Kernel setup (IRkernel, xeus-r, stata_kernel, pystata, saspy), environment configuration, troubleshooting
- **`references/data-sharing.md`** - Cross-kernel data sharing patterns (parquet, dta, csv, duckdb), full pipeline examples, validation patterns

### Example Files

Working code in `examples/`:

- **`examples/python_analysis.py`** - Python percent-format template with common patterns
- **`examples/r_analysis.R`** - R percent-format template for statistical analysis
- **`examples/cross_kernel_pipeline.py`** - Multi-kernel data sharing example

### Scripts

Utility scripts in `scripts/`:

- **`scripts/init_project.sh`** - Initialize jupytext project with standard structure
- **`scripts/sync_all.sh`** - Sync all paired notebooks in project

## Best Practices

1. **Always use percent format** - Best balance of readability and cell preservation
2. **Strip metadata for git** - Cleaner diffs with metadata filters
3. **Use parquet for interchange** - Type-safe, cross-language compatible
4. **Document kernel requirements** - Include in README or environment.yml
5. **Pre-commit hooks** - Ensure sync before commits
