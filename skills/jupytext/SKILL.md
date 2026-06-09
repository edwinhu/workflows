---
name: jupytext
description: Use when working with jupytext — converting notebooks to/from text formats, syncing paired .ipynb/.py files, multi-kernel projects (Python/R/Stata/SAS), or executing notebooks via papermill.
user-invocable: false
---

## Contents

- [Execution Enforcement](#execution-enforcement)
- [Core Concepts](#core-concepts)
- [Multi-Kernel Data Sharing](#multi-kernel-data-sharing)
- [Workflow Integration](#workflow-integration)
- [Project Structure](#project-structure)
- [Kernel Specification](#kernel-specification)
- [Quick Troubleshooting](#quick-troubleshooting)
- [Additional Resources](#additional-resources)
- [Best Practices](#best-practices)

# Jupytext Skill

Jupytext converts Jupyter notebooks to/from text formats (.py, .R, .md), enabling version control and multi-kernel workflows.

## Execution Enforcement

### IRON LAW: NO EXECUTION CLAIM WITHOUT OUTPUT VERIFICATION

Before claiming ANY jupytext script executed successfully, follow this sequence:
1. **EXECUTE** using the papermill pipeline: `jupytext --to notebook --output - script.py | papermill - output.ipynb`
2. **CHECK** for execution errors (papermill exit code and stderr)
3. **VERIFY** output.ipynb exists and is non-empty
4. **INSPECT** outputs using notebook-debug skill verification
5. **CLAIM** success only after verification passes

This is non-negotiable. Skipping papermill execution is NOT HELPFUL — the user gets a notebook that fails on first run.

### Jupytext Facts

- Papermill can exit 0 while cells contain tracebacks. Claiming success from the exit code alone is an unverified claim presented as fact — check output.ipynb for tracebacks.
- Use the papermill pipeline, not `jupyter nbconvert --execute` — papermill has better error handling, parameter injection, and logging, and the pipe form needs no intermediate `.ipynb` files.

### Red Flags

- About to return a converted .ipynb without executing it → run the papermill pipeline first.
- About to claim success from conversion or exit code alone → verify output.ipynb.

### Execution Verification Checklist

Before EVERY "notebook works" claim:

**Conversion:**
- [ ] Correct format specified (py:percent recommended)
- [ ] Conversion command succeeded
- [ ] No syntax errors in conversion

**Execution (MANDATORY):**
- [ ] Used recommended papermill pipeline: `jupytext --to notebook --output - script.py | papermill - output.ipynb`
- [ ] Papermill exit code is 0
- [ ] No errors in stderr
- [ ] output.ipynb file created
- [ ] output.ipynb is non-empty (>100 bytes)

**Output Verification:**
- [ ] Used notebook-debug skill's verification checklist
- [ ] No tracebacks in any cell
- [ ] All cells have execution_count (not null)
- [ ] Expected outputs present (plots, dataframes, metrics)
- [ ] No unexpected warnings or errors

**Multi-Kernel Projects (if applicable):**
- [ ] Correct kernel specified in header
- [ ] Interchange files created (parquet/DTA)
- [ ] Downstream notebooks can read interchange files

**Only after ALL checks pass:**
- [ ] Claim "notebook executed successfully"

### Gate Function: Jupytext Execution

Follow this sequence for EVERY jupytext task involving execution:

```
1. CONVERT  → jupytext --to notebook --output -
2. EXECUTE  → papermill - output.ipynb (with params if needed)
3. CHECK    → Verify exit code and stderr
4. INSPECT  → Use notebook-debug verification
5. VERIFY   → Outputs match expectations
6. CLAIM    → "Notebook works" only after all gates passed
```

**NEVER skip execution gate.** Converting without executing proves nothing about correctness.

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

**Markdown dollar signs:** Always wrap `$` in backticks to prevent LaTeX rendering - `# Cost: `$50`` not `# Cost: $50`

### Project Configuration

Create `jupytext.toml` in project root:

```toml
formats = "ipynb,py:percent"
notebook_metadata_filter = "-all"
cell_metadata_filter = "-all"
```

### Essential Commands

```bash
# Convert notebook to percent-format Python file
jupytext --to py:percent notebook.ipynb

# Convert Python script to Jupyter notebook format
jupytext --to notebook script.py

# Enable bidirectional pairing to keep formats synchronized
jupytext --set-formats ipynb,py:percent notebook.ipynb

# Synchronize paired notebook and text file
jupytext --sync notebook.ipynb
```

### Execution (Recommended Pattern)

**Always pipe to papermill for execution** - no intermediate files:

```bash
# Convert script to notebook and execute in atomic operation
jupytext --to notebook --output - script.py | papermill - output.ipynb

# Convert and execute with parameter injection
jupytext --to notebook --output - script.py | papermill - output.ipynb -p start_date "2024-01-01" -p n_samples 1000

# Convert and execute with detailed logging output
jupytext --to notebook --output - script.py | papermill - output.ipynb --log-output

# Convert and execute in memory without saving intermediate files
jupytext --to notebook --output - script.py | papermill - -
```

Key flags:
- `--output -` tells jupytext to write to stdout
- `papermill - output.ipynb` reads from stdin, writes to file
- `papermill - -` reads from stdin, writes to stdout (for inspection)

**Why this pattern:**
1. No intermediate `.ipynb` files cluttering the workspace
2. Single atomic operation - convert and execute together
3. Papermill handles parameters, logging, and error reporting
4. Works in CI/CD pipelines without temp file cleanup

### Debugging Runtime Errors

After execution, use `notebook-debug` skill to inspect tracebacks in the output ipynb.

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

Add the following to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/mwouts/jupytext
    rev: v1.16.0
    hooks:
      - id: jupytext
        args: [--sync]  # Synchronize paired formats before commit
```

### Version Control Strategy

Choose one approach:

- **Option A**: Commit only .py files (add `*.ipynb` to `.gitignore`) for minimal repository size
- **Option B**: Commit both formats to give reviewers format choice

### Editor Integration

Configure editors for automatic synchronization:

- **VS Code**: Install Jupytext extension for automatic bidirectional sync
- **JupyterLab**: Right-click notebook and select "Pair Notebook" for synchronization

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

1. **Use percent format** - Best balance of readability and cell preservation
2. **Strip metadata for git** - Use metadata filters for cleaner diffs
3. **Use parquet for interchange** - Type-safe, cross-language compatible format
4. **Document kernel requirements** - Include in README or environment.yml
5. **Enable pre-commit hooks** - Ensure synchronization before commits
