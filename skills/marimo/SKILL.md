---
name: marimo
description: Use when working with marimo notebooks — creating, editing, debugging, converting from Jupyter, or pairing with a running marimo server.
user-invocable: false
---

## Contents

- [Editing and Verification Enforcement](#editing-and-verification-enforcement)
- [Key Concepts](#key-concepts)
- [Cell Structure](#cell-structure)
- [Editing Rules](#editing-rules)
- [Core CLI Commands](#core-cli-commands)
- [Export Commands](#export-commands)
- [Live Session (marimo-pair)](#live-session-marimo-pair)
- [Data and Visualization](#data-and-visualization)
- [Debugging Workflow](#debugging-workflow)
- [Common Issues](#common-issues)
- [Additional Resources](#additional-resources)

# Marimo Reactive Notebooks

Marimo is a reactive Python notebook where cells form a DAG and auto-execute on dependency changes. Notebooks are stored as pure `.py` files.

## Editing and Verification Enforcement

### IRON LAW #1: NEVER MODIFY CELL DECORATORS OR SIGNATURES

Only edit code INSIDE `@app.cell` function bodies. This is not negotiable.

**NEVER modify:**
- Cell decorators (`@app.cell`)
- Function signatures (`def _(deps):`)
- Return statements structure (trailing commas required)

**ALWAYS verify:**
- All used variables are in function parameters
- All created variables are in return statement
- Trailing comma for single returns: `return var,`

### IRON LAW #2: NO EXECUTION CLAIM WITHOUT OUTPUT VERIFICATION

Before claiming ANY marimo notebook works:
1. **VALIDATE** syntax and structure: `marimo check notebook.py`
2. **EXECUTE** with outputs: `marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs`
3. **VERIFY** using notebook-debug skill's verification checklist
4. **CLAIM** success only after verification passes

This is not negotiable. Skipping execution and output inspection is NOT HELPFUL — the user gets a notebook that fails when they open it.

### Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "marimo check passed, so it works" | Syntax check ≠ runtime correctness | EXECUTE with --include-outputs and inspect |
| "Just a small change, can't break anything" | Reactivity means small changes propagate everywhere | VERIFY with full execution |
| "I'll let marimo handle the dependency tracking" | Verification of correct behavior is still required | CHECK outputs match expectations |
| "The function signature looks right" | Wrong deps/returns break reactivity silently | VALIDATE all vars are in params AND returns |
| "I can modify the function signature" | Breaks marimo's dependency detection | ONLY edit inside function bodies |
| "Variables can be used without returning them" | Will cause NameError in dependent cells | RETURN all created variables |
| "I can skip the trailing comma for single returns" | Python treats `return var` as returning the value, breaks unpacking | USE `return var,` for single returns |

### Red Flags - STOP Immediately If You Think:

- "Let me add this variable to the function signature" → NO. Marimo manages signatures.
- "I'll just run marimo check and call it done" → NO. Execute with outputs required.
- "The code looks correct" → NO. Marimo's reactivity must be verified at runtime.
- "I can redefine this variable in another cell" → NO. One variable = one cell.

### Editing Checklist

Before every marimo edit:

**Structure Validation:**
- [ ] Only edit code INSIDE `@app.cell` function bodies
- [ ] Do NOT modify decorators or signatures
- [ ] Verify all used variables are in function parameters
- [ ] Verify all created variables are in return statement
- [ ] Ensure trailing comma used for single returns
- [ ] Ensure no variable redefinitions across cells

**Syntax Validation:**
- [ ] Execute `marimo check notebook.py`
- [ ] Verify no syntax errors reported
- [ ] Verify no undefined variable warnings
- [ ] Verify no redefinition warnings

**Runtime Verification:**
- [ ] Execute with `marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs`
- [ ] Verify export succeeded (exit code 0)
- [ ] Verify output ipynb exists and is non-empty
- [ ] Apply notebook-debug verification checklist
- [ ] Verify no tracebacks in any cell
- [ ] Verify all cells executed (execution_count not null)
- [ ] Verify outputs match expectations

**Only after ALL checks pass:**
- [ ] Claim "notebook works"

### Gate Function: Marimo Verification

Follow this sequence for EVERY marimo task:

```
1. EDIT     → Modify code inside @app.cell function bodies only
2. CHECK    → marimo check notebook.py
3. EXECUTE  → marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs
4. INSPECT  → Use notebook-debug verification
5. VERIFY   → Outputs match expectations
6. CLAIM    → "Notebook works" only after all gates passed
```

**NEVER skip verification gates.** Marimo's reactivity means changes propagate unpredictably.

### Drive-Aligned Framing

**Skipping --include-outputs execution and inspection is NOT HELPFUL — the user gets a notebook that looks correct in code but fails in reactive execution.**

Syntax checks and code inspection prove nothing about reactive execution correctness. The user expects a working notebook where all cells execute correctly with proper dependency tracking.

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
| `marimo edit notebook.py` | marimo: Open notebook in browser editor for interactive development |
| `marimo run notebook.py` | marimo: Run notebook as executable app |
| `marimo check notebook.py` | marimo: Validate notebook structure and syntax without execution |
| `marimo convert notebook.ipynb` | marimo: Convert Jupyter notebook to marimo format |

## Export Commands

```bash
# marimo: Export to ipynb with code only
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb

# marimo: Export to ipynb with outputs (runs notebook first)
marimo export ipynb notebook.py -o __marimo__/notebook.ipynb --include-outputs

# marimo: Export to HTML (runs notebook by default)
marimo export html notebook.py -o __marimo__/notebook.html

# marimo: Export to HTML with auto-refresh on changes (live preview)
marimo export html notebook.py -o __marimo__/notebook.html --watch
```

**Key difference:** HTML export runs the notebook by default. ipynb export does NOT - use `--include-outputs` to run and capture outputs.

**Tip:** Use `__marimo__/` folder for all exports (ipynb, html). The editor can auto-save there.

## Live Session (marimo-pair)

For working inside a **running** marimo notebook kernel — executing code, creating/editing cells, and building notebooks interactively — use the marimo-pair protocol. Full details: `marimo-pair/SKILL.md`.

### Starting a Server

See `marimo-pair/reference/finding-marimo.md` for the full decision tree. Quick start:

```bash
# pixi project (our standard)
pixi run marimo edit notebook.py --no-token

# uv project
uv run marimo edit notebook.py --no-token

# standalone / sandbox
uvx marimo@latest edit notebook.py --no-token --sandbox
```

**Always start as a background task** (`run_in_background`) so the server doesn't block the conversation. Do NOT use `--headless` unless asked — let marimo open the browser.

### Discovery and Execution

```bash
# Discover running servers
bash ${CLAUDE_SKILL_DIR}/marimo-pair/scripts/discover-servers.sh

# Execute code in the kernel (one-liner)
bash ${CLAUDE_SKILL_DIR}/marimo-pair/scripts/execute-code.sh -c "df.head()"

# Execute code (multiline — use heredoc to avoid shell escaping)
bash ${CLAUDE_SKILL_DIR}/marimo-pair/scripts/execute-code.sh <<'EOF'
import marimo._code_mode as cm

async with cm.get_context() as ctx:
    cid = ctx.create_cell("x = 1")
    ctx.run_cell(cid)
EOF
```

Use `--port` to target a specific server, `--session` for a specific notebook, `--url` for remote servers.

### Key Concepts

- **Scratchpad execution**: Code runs in the kernel with all cell variables in scope, but nothing persists between calls. Use this to explore and validate.
- **Cell mutations**: Use `marimo._code_mode` with `async with cm.get_context() as ctx:` to create/edit/delete cells and install packages. All `ctx.*` methods are synchronous — do NOT await them.
- **Cells are not auto-executed**: `create_cell` and `edit_cell` are structural only — call `ctx.run_cell(cid)` to execute.
- **Install packages via `ctx.install_packages()`**, not `uv add` or `pip`.
- **NEVER write to the `.py` file directly while a session is running** — the kernel owns it.

### marimo-pair References

- `marimo-pair/reference/finding-marimo.md` — How to find and invoke the right marimo binary
- `marimo-pair/reference/gotchas.md` — Cached module proxies and other traps
- `marimo-pair/reference/rich-representations.md` — Custom anywidgets, `_display_()`, Arrow IPC for large data
- `marimo-pair/reference/notebook-improvements.md` — Setup cells, lifting functions, `mo.persistent_cache`

## Data and Visualization

- Prefer polars over pandas for performance
- Use `mo.ui` for interactive widgets
- SQL cells: `mo.sql(df, "SELECT * FROM df")`
- Display markdown: `mo.md("# Heading")`

## Debugging Workflow

**1. Pre-execution validation:**
```bash
# scripts: Validate notebook syntax and cell structure
scripts/check_notebook.sh notebook.py
```
Runs syntax check, marimo validation, and cell structure overview in one command.

**2. Runtime errors:** Export with outputs, then use `notebook-debug` skill:
```bash
# marimo: Export to ipynb with outputs for inspection
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

For detailed patterns and advanced techniques, consult:
- **`references/reactivity.md`** - DAG execution, variable rules, dependency detection patterns
- **`references/debugging.md`** - Error patterns, runtime debugging, environment-specific issues
- **`references/widgets.md`** - Interactive UI components and mo.ui patterns
- **`references/sql.md`** - SQL cells and database integration techniques
- **`marimo-pair/reference/finding-marimo.md`** - How to find and invoke marimo across project types
- **`marimo-pair/reference/gotchas.md`** - Cached module proxies (e.g., polars + pyarrow mid-session)
- **`marimo-pair/reference/rich-representations.md`** - Custom anywidgets, Arrow IPC, `_display_()` protocol
- **`marimo-pair/reference/notebook-improvements.md`** - Setup cells, lifting functions, `mo.persistent_cache`

### Examples

Working examples available in `examples/`:
- **`examples/basic_notebook.py`** - Minimal marimo notebook structure
- **`examples/data_analysis.py`** - Data loading, filtering, and visualization patterns
- **`examples/interactive_widgets.py`** - Interactive UI component usage

### Scripts

Validation and live-session utilities:
- **`scripts/check_notebook.sh`** - Primary validation: syntax check, marimo validation, cell structure overview
- **`scripts/get_cell_map.py`** - Extract cell metadata (invoked by check_notebook.sh)
- **`marimo-pair/scripts/discover-servers.sh`** - Find running marimo servers
- **`marimo-pair/scripts/execute-code.sh`** - Execute code in a running marimo kernel

### Related Skills

- **`notebook-debug`** - Debugging executed ipynb files with tracebacks and output inspection
- **`marimo-pair/SKILL.md`** - Full marimo-pair protocol for live kernel interaction
