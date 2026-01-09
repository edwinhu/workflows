---
name: marimo
description: This skill should be used when the user asks to "use marimo", "create a marimo notebook", "debug a marimo notebook", "inspect cells", "understand reactive execution", "fix marimo errors", "convert from jupyter to marimo", or works with marimo reactive Python notebooks.
---

## Contents

- [Key Concepts](#key-concepts)
- [Cell Structure](#cell-structure)
- [Editing Rules](#editing-rules)
- [Core CLI Commands](#core-cli-commands)
- [Export Commands](#export-commands)
- [Data and Visualization](#data-and-visualization)
- [Debugging Workflow](#debugging-workflow)
- [Common Issues](#common-issues)
- [Additional Resources](#additional-resources)

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
- **Markdown cells: Always wrap `$` in backticks** - `mo.md("Cost: `$50`")` not `mo.md("Cost: $50")`

## Core CLI Commands

| Command | Purpose |
|---------|---------|
| `marimo edit notebook.py` | Open in browser editor |
| `marimo run notebook.py` | Run as app |
| `marimo check notebook.py` | Check for errors (no execution) |
| `marimo convert notebook.ipynb` | Convert from Jupyter |

## Export Commands

```bash
# Export to ipynb (code only, no outputs)
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb

# Export to ipynb WITH outputs (runs notebook first)
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs

# Export to HTML (runs notebook by default)
marimo export html notebook.py -o __marimo__/notebook.html

# Export to HTML with auto-refresh on changes (great for live preview)
marimo export html notebook.py -o __marimo__/notebook.html --watch
```

**Key difference:** HTML export runs the notebook by default. ipynb export does NOT - use `--include-outputs` to run and capture outputs.

**Tip:** Use `__marimo__/` folder for all exports (ipynb, html). The editor can auto-save there.

## Data and Visualization

- Prefer polars over pandas for performance
- Use `mo.ui` for interactive widgets
- SQL cells: `mo.sql(df, "SELECT * FROM df")`
- Display markdown: `mo.md("# Heading")`

## Debugging Workflow

**1. Pre-execution validation:**
```bash
scripts/check_notebook.sh notebook.py
```
Runs syntax check + `marimo check` + cell structure overview in one command.

**2. Runtime errors:** Export with outputs, then use `notebook-debug` skill:
```bash
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs
```

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

- **`scripts/check_notebook.sh`** - Primary validation: syntax + marimo check + cell structure
- **`scripts/get_cell_map.py`** - Extract cell metadata (called by check_notebook.sh)

### Related Skills

- **`notebook-debug`** - Debugging executed ipynb files (tracebacks, Read vs jq inspection)
