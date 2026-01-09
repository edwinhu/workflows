---
name: notebook-debug
description: This skill should be used when the user asks to "debug notebook", "inspect notebook outputs", "find notebook error", "read traceback from ipynb", "why did notebook fail", or needs to understand runtime errors in executed Jupyter notebooks from any source (marimo, jupytext, papermill).
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

## Verification Enforcement

### IRON LAW: NO 'NOTEBOOK WORKS' CLAIM WITHOUT TRACEBACK CHECK

Before claiming ANY notebook executed successfully, you MUST:
1. **EXECUTE** the notebook to ipynb with outputs
2. **CHECK** for tracebacks (Quick Failure Check section)
3. **READ** the ipynb file with Read tool if errors found
4. **VERIFY** all cells have execution_count (not null)
5. **INSPECT** outputs for warnings/unexpected behavior
6. **CLAIM** success only after all verification passes

This is not negotiable. Claiming "notebook works" without checking for tracebacks is LYING to the user.

### Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The command succeeded, so notebook works" | Exit code 0 ≠ no errors | CHECK for tracebacks in outputs |
| "I'll just run the source file directly" | You'll miss cell-level errors | EXECUTE to ipynb first, then inspect |
| "User will see errors when they run it" | You're wasting their time | VERIFY before claiming completion |
| "I can see the code, so I know it works" | Code that looks right can still fail | EXECUTE and READ outputs |
| "Quick check with grep is enough" | Grep misses stderr and cell outputs | Use BOTH quick check AND Read tool |
| "Only the last cell matters" | Middle cells can fail silently | VERIFY all cells executed (execution_count) |
| "I'll fix errors if user reports them" | Proactive checking is your job | CHECK before user sees it |

### Red Flags - STOP Immediately If You Think:

- "Let me run marimo/jupytext and assume it worked" → NO. Execute to ipynb and CHECK outputs.
- "The notebook ran last time, so it still works" → NO. Fresh execution EVERY time.
- "I can tell from the code that it's correct" → NO. Code inspection ≠ runtime verification.
- "Just a small change, can't break anything" → NO. Small changes cause big failures.

### Verification Checklist

Before EVERY "notebook works" claim:

**Execution:**
- [ ] Notebook executed to ipynb format
- [ ] `--include-outputs` flag used (for marimo)
- [ ] Output file created successfully
- [ ] Output file is non-empty

**Traceback Check:**
- [ ] Quick failure check executed: `jq -r '.cells[].outputs[]?.text[]?' | grep "Traceback"`
- [ ] Error count checked: `jq '[.cells[].outputs[]? | select(.output_type == "error")] | length'`
- [ ] If errors found: Read tool used to inspect full context

**Cell Execution:**
- [ ] All cells have execution_count (no null values)
- [ ] Execution order is sequential (no out-of-order cells)
- [ ] No cells skipped due to prior failures

**Output Inspection:**
- [ ] Critical outputs verified (not just no errors)
- [ ] Expected results present (dataframes, plots, metrics)
- [ ] No warnings that indicate problems
- [ ] No unexpected NaN/None/empty results

**Only after ALL checks pass:**
- [ ] Claim "notebook executed successfully" with confidence

### Gate Function: Notebook Verification

Follow this sequence for EVERY notebook debugging task:

```
1. EXECUTE → Run to ipynb with outputs
2. CHECK   → Quick traceback/error count check
3. READ    → Full inspection with Read tool if errors
4. VERIFY  → All cells executed, outputs as expected
5. CLAIM   → "Notebook works" only after all gates passed
```

**NEVER skip any gate.** Each gate catches different failure modes.

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
