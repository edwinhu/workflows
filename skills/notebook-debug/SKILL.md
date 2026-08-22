---
name: notebook-debug
description: ALWAYS use when an executed notebook has to be checked or has gone wrong - "debug this notebook", "why did the notebook fail", "which cell errored", "read the traceback from the ipynb", "the notebook ran but the output looks wrong", "did all the cells run", "papermill/jupytext/marimo execution failed", "inspect the notebook outputs". Use proactively before claiming any .ipynb executed successfully — never assert a notebook works without checking its outputs for tracebacks.
user-invocable: false
---

## Contents

- [Verification Enforcement](#verification-enforcement)
- [Why Execute to ipynb?](#why-execute-to-ipynb)
- [Execution Commands](#execution-commands)
- [Inspection Methods](#inspection-methods)
- [Quick Failure Check](#quick-failure-check)
- [Read Tool for Debugging](#read-tool-for-debugging)
- [Common Patterns](#common-patterns)
- [Debugging Workflow](#debugging-workflow)

# Debugging Executed Notebooks

This skill covers inspecting executed `.ipynb` files to debug runtime errors, regardless of how the notebook was created (marimo, jupytext, or plain Jupyter).

**If debugging within a /ds workflow**, first read `.planning/LEARNINGS.md` for pipeline context and `.planning/PLAN.md` for task expectations.

## Verification Enforcement

### IRON LAW: NO 'NOTEBOOK WORKS' CLAIM WITHOUT TRACEBACK CHECK

Before claiming ANY notebook executed successfully, you MUST:
1. **EXECUTE** the notebook to ipynb with outputs
2. **CHECK** for tracebacks (Quick Failure Check section)
3. **READ** the ipynb file with Read tool if errors found
4. **VERIFY** all cells have execution_count (not null)
5. **INSPECT** outputs for warnings/unexpected behavior
6. **CLAIM** success only after all verification passes

This is not negotiable. Skipping traceback checks is NOT HELPFUL — the user opens a notebook that throws errors on first run.

### Notebook Execution Facts

- Exit code 0 from the executor does not mean the cells succeeded — tracebacks live inside cell outputs. Claiming "notebook works" from the exit code alone is an unverified claim presented as fact.
- Running the `.py` source file directly loses cell-level outputs and error attribution. Execute to ipynb first, then inspect.
- The grep quick check reads only `outputs[].text` — it misses stderr and structured `error` outputs. Use BOTH the quick check AND the Read tool.
- Cells downstream of a failure are skipped with `execution_count: null` — a middle-cell failure is invisible unless you verify every cell executed.
- The cell that raises is often not the root cause — bad data originates upstream (observed: root cause 5 cells above the error cell). Tracing only the error cell misses it.

### Red Flags — STOP If About To:

- Claim success without checking the exported ipynb outputs → STOP. Execute to ipynb and inspect.
- Reuse a previous run's outputs as evidence → STOP. Fresh execution EVERY time.
- Claim correctness from reading the source code → STOP. Code inspection ≠ runtime verification.
- Apply a fix without reproducing the error first → STOP. An unreproduced fix is an unverifiable fix.

### Verification Checklist

Before claiming "notebook works":

**Execution:**
- [ ] Execute notebook to ipynb format
- [ ] Use `--include-outputs` flag (for marimo)
- [ ] Verify output file created successfully
- [ ] Verify output file is non-empty

**Traceback Check:**
- [ ] Run quick failure check: `jq -r '.cells[].outputs[]?.text[]?' | grep "Traceback"`
- [ ] Check error count: `jq '[.cells[].outputs[]? | select(.output_type == "error")] | length'`
- [ ] Use Read tool to inspect full context if errors found

**Cell Execution:**
- [ ] Verify all cells have execution_count (no null values)
- [ ] Check execution order is sequential (no out-of-order cells)
- [ ] Verify no cells skipped due to prior failures

**Output Inspection:**
- [ ] Verify critical outputs (not just absence of errors)
- [ ] Check expected results present (dataframes, plots, metrics)
- [ ] Verify no warnings that indicate problems
- [ ] Check no unexpected NaN/None/empty results

**Claim success only after:**
- [ ] All checks pass: declare "notebook executed successfully"

### Gate Function: Notebook Verification

Apply this verification sequence for every notebook debugging task:

```
1. EXECUTE → Run to ipynb with outputs
2. CHECK   → Quick traceback/error count check
3. READ    → Full inspection with Read tool if errors
4. VERIFY  → All cells executed, outputs as expected
5. CLAIM   → "Notebook works" only after all gates passed
```

**Never skip any gate.** Each gate catches different failure modes.

## Why Execute to ipynb?

Converting and executing notebooks to ipynb captures:
- Cell outputs and return values
- Tracebacks with full context
- Execution order and cell IDs

This makes debugging much easier than reading raw `.py` source.

## Execution Commands

```bash
# Export marimo notebook to ipynb with outputs
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs

# Convert jupytext to ipynb and execute with outputs
jupytext --to notebook --output - script.py | papermill - output.ipynb

# Execute existing ipynb notebook to capture outputs
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
# Check for tracebacks in notebook outputs
jq -r '.cells[].outputs[]?.text[]?' notebook.ipynb | grep "Traceback"

# Count error outputs in notebook
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

Use the Read tool to inspect the notebook and locate tracebacks:
```bash
# Read notebook to find traceback location inline after failing cell
Read __marimo__/notebook.ipynb
```

### Check Cell Execution Count

Identify cells that did not execute:
```bash
# Find cells with null execution_count (not executed)
jq '.cells[] | select(.execution_count == null) | .source[:50]' notebook.ipynb
```

### Extract All Errors

Gather all error outputs from executed cells:
```bash
# Extract error tracebacks from all cells
jq -r '.cells[].outputs[]? | select(.output_type == "error") | .traceback[]' notebook.ipynb
```

## Debugging Workflow

1. **Execute notebook with outputs captured:**
   ```bash
   # Export marimo notebook to ipynb format with all outputs
   marimo export ipynb nb.py -o __marimo__/nb.ipynb --include-outputs
   ```

2. **Run quick failure check:**
   ```bash
   # Check if execution produced tracebacks
   jq -r '.cells[].outputs[]?.text[]?' __marimo__/nb.ipynb | grep -q "Traceback" && echo "FAILED"
   ```

3. **Inspect notebook using Read tool:**
   ```bash
   # Read the full notebook to identify failing cells and their errors
   Read __marimo__/nb.ipynb
   ```

4. **Fix source code and re-run to verify**
