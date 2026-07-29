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

### Marimo Facts

- `marimo check` validates syntax and structure only — it never executes cells. Claiming a notebook works because check passed is an unverified claim presented as fact.
- Reactivity propagates every edit through the DAG: a one-line change re-executes all dependent cells. Verifying only the edited cell misses downstream breakage — counterproductive on its own terms.
- Wrong dependencies or missing returns break reactivity silently: no error at edit time, only a NameError when a dependent cell runs. Validate that all used variables are in params AND all created variables are in returns.
- A variable created but not returned raises NameError in every cell that depends on it.
- Python treats `return var` as returning the bare value, which breaks unpacking — single returns require the trailing comma (`return var,`).

### Red Flags — STOP If About To:

- Edit a `@app.cell` decorator or `def _(...)` signature → STOP. Marimo manages these; edit only the function body.
- Claim done after only `marimo check` → STOP. Execution with `--include-outputs` is required.
- Claim the notebook works from reading the code → STOP. Reactive correctness shows only at runtime.
- Define a variable that another cell already defines → STOP. One variable = one cell.

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
pixi run marimo edit notebook.py --no-token --watch

# uv project
uv run marimo edit notebook.py --no-token --watch

# standalone / sandbox
uvx marimo@latest edit notebook.py --no-token --watch --sandbox
```

**Always use `--watch`** so the server detects file edits and reloads automatically. Without it, file changes are invisible to the browser and the user sees stale content.

**Always start as a background task** (`run_in_background`) so the server doesn't block the conversation. Do NOT use `--headless` unless asked — let marimo open the browser.

### Remote Box? Bind to the Tailnet, Don't Ask for SSH Forwarding

`marimo edit` binds **127.0.0.1** by default. When the notebook runs on a remote host and the user
is on SSH, that is unreachable — they get nothing, and the obvious next move (tell them to set up
`LocalForward`) costs them a config edit *and* a reconnect before they can look at anything.

Bind to the machine's Tailscale address instead. It works immediately, from any tailnet device
including a phone, with no client-side change:

```bash
TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
setsid nohup marimo edit notebook.py --no-token --watch --headless \
  --host "$TS_IP" --port 2718 > /tmp/marimo.log 2>&1 < /dev/null & disown

# confirm it is actually reachable — a bind is not a connection
ss -ltn | grep 2718
curl -s -o /dev/null -w '%{http_code}\n' "http://$TS_IP:2718"    # want 200
```

Then hand the user `http://$TS_IP:2718`. `--headless` is correct here (the opposite of the
local-box default above): a remote host has no browser to open.

**Tear it down when the review closes.** A `--no-token` server left running is an open notebook
kernel on the tailnet, and the next session's `discover-servers.sh` finds a stale one bound to a
notebook nobody is reviewing.

```bash
# record the pid at launch — this is the safe handle
echo $! > /tmp/marimo.pid
kill "$(cat /tmp/marimo.pid)"
```

### IRON LAW #3: `import marimo` GOES IN THE FIRST ~400 BYTES

**Never put a module docstring, licence header, or comment block in front of
`import marimo`. This is not negotiable.**

marimo decides whether a `.py` file is a notebook by scanning only the head of
the file. Push the signature past that window and the file is still a perfectly
valid notebook that runs, checks, and exports — it simply **stops appearing in
the workspace listing**, and there is no error anywhere to explain why.

Measured on 0.23.4 by bisection, identical files differing only in a leading
docstring:

| `import marimo` at byte | workspace listing |
|---|---|
| 0, 167, 246, 325, 404 | **listed** |
| 483, 562, 641 | **hidden** |

Put explanatory prose in an `mo.md` intro cell instead — a module docstring is
invisible in the rendered notebook anyway, so the "documentation" it buys costs
the file its discoverability and shows the reader nothing.

**If a notebook you just wrote is missing from the workspace, check the byte
offset of `import marimo` before anything else:**

```bash
python3 -c "print(open('nb.py').read().index('import marimo'))"   # want < 400
```

Diagnose the listing directly rather than guessing at the server — the API
answers precisely, including the root it is scanning:

```bash
TOK=$(curl -s "http://$HOST:$PORT" | grep -oP '(?<=data-token=")[^"]+' | head -1)
curl -s -X POST -H 'Content-Type: application/json' -H "Marimo-Server-Token: $TOK" \
  -d '{}' "http://$HOST:$PORT/api/home/workspace_files"
```

### Server Lifecycle Facts

- marimo's workspace file browser roots at the process **cwd**, not at the path argument. Running
  `marimo edit notebooks/` from the repo root serves that directory but browses the root, so the
  workspace lists nothing while "recent notebooks" still shows whatever was opened before — which
  reads as a marimo bug rather than a launch mistake. `cd` into the directory first.
- A notebook whose `import marimo` sits past ~400 bytes is invisible in the workspace listing while
  remaining fully valid — it runs, `marimo check` passes, `export` works. Iron Law #3 above.
- `marimo edit` binds `127.0.0.1` unless told otherwise. On a remote host that is invisible to an
  SSH-connected user, and answering "set up a LocalForward" spends their reconnect to buy what
  `--host <tailnet-ip>` gives for free. Verified: `LISTEN 127.0.0.1:2718` before, `HTTP 200` on the
  tailnet address after.
- Bind to the **specific tailnet IP**, never `0.0.0.0`. With `--no-token` there is no auth at all,
  so the bind address *is* the access control — `0.0.0.0` exposes an executing kernel to every
  interface the box has.
- `pkill -f 'marimo edit notebook.py'` **matches the shell running it**, because `-f` sees the full
  command line including your own. Measured: it killed the launching shell and took the new server
  with it, leaving nothing listening and an empty log that reads like a startup failure. Record the
  PID at launch, or use `pkill -x marimo` / a `[m]arimo` character class.
- **`marimo export` rewrites the source `.py` it exports.** Measured with the server idle: one
  `export html` moved the notebook's mtime by 39 seconds without touching content. So exporting two
  formats leaves the first one older than the source — any "is the export newer than the source?"
  freshness check fails for whichever ran first. Export the format you will actually gate on
  **last**. Discovering this at the gate, after the work is done, is the expensive way to learn it.

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
