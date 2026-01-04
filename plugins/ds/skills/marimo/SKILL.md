---
name: marimo
description: This skill should be used when the user asks to "use marimo", "create a marimo notebook", "debug a marimo notebook", "inspect cells", "understand reactive execution", "fix marimo errors", "convert from jupyter to marimo", or works with marimo reactive Python notebooks.
---

# Marimo Reactive Notebooks

Marimo is a reactive Python notebook where cells form a DAG and auto-execute on dependency changes. Notebooks are stored as pure `.py` files.

## Key Concepts

- **Reactive execution**: Cells auto-update when dependencies change
- **No hidden state**: Each variable defined in exactly one cell
- **Pure Python**: `.py` files, version control friendly
- **Cell structure**: `@app.cell` decorator pattern

## Cell Structure

```python
import marimo

app = marimo.App()

@app.cell
def _(pl):  # Dependencies as parameters
    df = pl.read_csv("data.csv")
    return df,  # Trailing comma required for single return

@app.cell
def _(df, pl):
    summary = df.describe()
    filtered = df.filter(pl.col("value") > 0)
    return summary, filtered  # Multiple returns
```

## Editing Rules

- Edit code INSIDE `@app.cell` functions only
- Never modify cell decorators or function signatures
- Variables cannot be redefined across cells
- All used variables must be returned from their defining cell

## Core CLI Commands

| Command | Purpose |
|---------|---------|
| `marimo edit notebook.py` | Open in browser editor |
| `marimo run notebook.py` | Run as app |
| `marimo check notebook.py` | Check for errors (no execution) |
| `marimo convert notebook.ipynb` | Convert from Jupyter |

## Data and Visualization

- Prefer polars over pandas for performance
- Use `mo.ui` for interactive widgets
- SQL cells: `mo.sql(df, "SELECT * FROM df")`
- Display markdown: `mo.md("# Heading")`

## Debugging Quick Reference

Run `marimo check notebook.py` first to catch:
- Variable redefinition errors
- Circular dependencies
- Missing returns
- Syntax errors

Use `scripts/get_cell_map.py` to inspect cell structure without running.

## Common Issues

| Issue | Fix |
|-------|-----|
| Variable redefinition | Rename one variable or merge cells |
| Circular dependency | Break cycle by merging or restructuring |
| Missing return | Add `return var,` with trailing comma |
| Import not available | Ensure import cell returns the module |

## Additional Resources

### Reference Files

- **`references/reactivity.md`** - DAG execution, variable rules, dependency detection
- **`references/debugging.md`** - Error patterns, runtime debugging, environment issues
- **`references/widgets.md`** - Interactive UI components and mo.ui patterns
- **`references/sql.md`** - SQL cells and database integration

### Example Files

- **`examples/basic_notebook.py`** - Minimal marimo notebook structure
- **`examples/data_analysis.py`** - Data loading, filtering, visualization pattern
- **`examples/interactive_widgets.py`** - Using mo.ui for interactivity

### Scripts

- **`scripts/get_cell_map.py`** - Extract cell metadata from notebook
- **`scripts/check_notebook.sh`** - Quick validation wrapper
