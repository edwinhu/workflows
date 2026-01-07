---
name: notebook-debug
description: This skill should be used when the user asks to "debug notebook", "inspect notebook outputs", "find notebook error", ...
---
## Contents

- [Why Execute to ipynb?](#why-execute-to-ipynb)
- [Execution Commands](#execution-commands)
- [Inspection Methods](#inspection-methods)
- [Quick Failure Check](#quick-failure-check)
- [Read Tool for Debugging](#read-tool-for-debugging)
- [Common Patterns](#common-patterns)
- [Debugging Workflow](#debugging-workflow)

# Debugging Executed Notebooks

This skill covers inspecting executed `.ipynb` files to debug runtime errors, regardless of how the notebook was created (marimo, jupytext, or plain Jupyter).

## Why Execute to ipynb?

Converting and executing notebooks to ipynb captures:
- Cell outputs and return values
- Tracebacks with full context
- Execution order and cell IDs

This makes debugging much easier than reading raw `.py` source.

## Execution Commands

```bash
# From marimo .py
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs

# From jupytext .py (percent format)
jupytext --to notebook --output - script.py | papermill - output.ipynb

# Execute existing ipynb
papermill input.ipynb output.ipynb
```

## Inspection Methods

|                  | jq                            | Read tool           |
|------------------|-------------------------------|---------------------|
| Output           | Raw JSON with escaped strings | Clean rendered view |
| Error visibility | Buried in outputs array       | Inline after cell   |
| Cell context     | Need to piece together        | Cell IDs visible    |
| Scripting        | Better for automation         | Not scriptable      |

**Verdict:** Use Read for debugging/inspection, jq for scripting/CI.

## Quick Failure Check

```bash
# Check if any cell has a traceback
jq -r '.cells[].outputs[]?.text[]?' notebook.ipynb | grep "Traceback"

# Count errors
jq '[.cells[].outputs[]? | select(.output_type == "error")] | length' notebook.ipynb
```

## Read Tool for Debugging

The Read tool renders ipynb with errors inline after the failing cell:

```
<cell id="MJUe">raise ValueError("intentional error")</cell>

Traceback (most recent call last):
  File "/path/to/notebook.py", line 5, in <module>
    raise ValueError("intentional error")
ValueError: intentional error

<cell id="vblA">y = x + 10  # depends on x, not the error cell</cell>
```

Benefits:
- Errors appear immediately after the cell that caused them
- Cell IDs visible for cross-referencing
- Full traceback with line numbers
- No JSON parsing needed

## Common Patterns

### Find the Failing Cell

```bash
# Use Read tool
Read __marimo__/notebook.ipynb
# Look for "Traceback" in output
```

### Check Cell Execution Count

```bash
# Cells with execution_count: null were not run
jq '.cells[] | select(.execution_count == null) | .source[:50]' notebook.ipynb
```

### Extract All Errors

```bash
jq -r '.cells[].outputs[]? | select(.output_type == "error") | .traceback[]' notebook.ipynb
```

## Debugging Workflow

1. **Execute with outputs captured:**
   ```bash
   marimo export ipynb nb.py -o __marimo__/nb.ipynb --include-outputs
   ```

2. **Quick check for failures:**
   ```bash
   jq -r '.cells[].outputs[]?.text[]?' __marimo__/nb.ipynb | grep -q "Traceback" && echo "FAILED"
   ```

3. **Inspect with Read tool:**
   ```bash
   Read __marimo__/nb.ipynb
   ```

4. **Fix source and re-run**