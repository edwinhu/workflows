# Hook Scripts

This directory contains hook scripts that enforce quality checks and automation for notebook workflows.

## Overview

| Hook | Event | Purpose | Intrusion Level |
|------|-------|---------|----------------|
| **common/dispatcher.py** | PreToolUse | Workflow activation, ralph validation, anti-patterns | Medium (some blocking) |
| **marimo/marimo-check.py** | PostToolUse | Validate marimo notebook structure | Very Low (warnings only) |
| **jupytext/jupytext-sync.py** | PostToolUse | Sync paired notebooks + lint | Low (automatic, informational) |

## Notebook Hooks

### Marimo Hook (`marimo/marimo-check.py`)

**What it does:**
- Runs `uvx marimo check` after editing `.py` files with `import marimo` and `@app.cell`
- Catches structural errors: multiple definitions, syntax errors, invalid cells
- Non-blocking warnings

**Example output:**
```
⚠️ marimo check found issues in notebook.py:
critical[multiple-definitions]: Variable 'a' is defined in multiple cells
hint: Variables must be unique across cells...
```

**When to use:**
- Working with marimo reactive notebooks
- Want immediate feedback on structural issues
- Prefer mechanical enforcement over behavioral guidance

### Jupytext Hook (`jupytext/jupytext-sync.py`)

**What it does:**
- Runs `uvx jupytext --sync` to keep paired `.py`/`.ipynb` files synchronized
- Detects language (Python/R/Stata/SAS) and runs appropriate linters
- Reports sync status and lint issues
- Non-blocking, silent when no sync needed

**Example output:**
```
✓ Synced analysis.py with paired notebook

⚠️ Linting issues found:
  • ruff: E225 Missing whitespace around operator
  • black: File would be reformatted
```

**When to use:**
- Working with jupytext paired notebooks
- Want automatic sync after edits
- Multi-language projects (Python/R/Stata/SAS)

## Comparison: Marimo vs Jupytext Hooks

| Aspect | Marimo | Jupytext |
|--------|--------|----------|
| **Primary action** | Validate structure | Sync files |
| **Side effects** | None (read-only) | Modifies paired files |
| **Language support** | Python only | Python, R, Stata, SAS |
| **Linting** | Built into check | Optional, multi-linter |
| **Detection** | `import marimo` + `@app.cell` | `# %%` or `jupyter:` metadata |
| **Output** | Only on errors | Only on sync or issues |
| **Speed** | Very fast (<100ms) | Fast (may fetch with uvx first run) |

## Design Philosophy

Both hooks follow these principles:

1. **Mechanical > Behavioral**: Enforce what can be checked automatically
2. **Non-blocking**: Warnings, not errors - allow workflow to continue
3. **Silent on success**: No noise when everything is correct
4. **Fast path**: Exit immediately for non-matching files
5. **uvx for tools**: No installation required, automatic fetching

## Enforcement Patterns

From the [superpowers](https://github.com/obra/superpowers) project:

- **Iron Laws**: "NO X WITHOUT Y FIRST" - Use hooks for absolute constraints
- **Gate Functions**: IDENTIFY → RUN → VERIFY → CLAIM
- **Rationalization Tables**: Preempt defensive thinking with mechanical checks

These hooks implement gate functions:
- Marimo: EDIT → CHECK → REPORT → CONTINUE
- Jupytext: EDIT → SYNC → LINT → REPORT → CONTINUE

## Configuration

Hooks are registered in `/hooks/hooks.json`:

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        {
          "type": "command",
          "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/marimo/marimo-check.py"
        },
        {
          "type": "command",
          "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/jupytext/jupytext-sync.py"
        }
      ]
    }
  ]
}
```

## Requirements

- `uv` installed (provides `uvx` command)
- Python 3.8+ for hook scripts
- Optional: linters for jupytext (ruff, black, lintr, stata-linter, sasjs)

## Testing

Each hook includes test files:

```bash
# Test marimo hook
cd hooks/scripts/marimo
echo '{"tool_name": "Edit", "tool_input": {"file_path": "test_multiple_def.py"}}' | python3 marimo-check.py

# Test jupytext hook
cd hooks/scripts/jupytext
echo '{"tool_name": "Edit", "tool_input": {"file_path": "test_python.py"}}' | python3 jupytext-sync.py
```

## Adding New Hooks

To add a new notebook hook:

1. Create directory: `hooks/scripts/your-hook/`
2. Create script: `your-hook.py` with stdin JSON parsing
3. Add detection logic (file patterns, metadata checks)
4. Run tool via `uvx` if possible (no installation)
5. Format output as hookSpecificOutput JSON
6. Register in `hooks/hooks.json`
7. Document in `README.md`
8. Create test files

See existing hooks for reference patterns.

## Related Documentation

- **Marimo skill**: `skills/marimo/SKILL.md` - Behavioral guidance
- **Jupytext skill**: `skills/jupytext/SKILL.md` - Workflow patterns
- **Hook development**: `common/hooks/hook-development/SKILL.md` - Creating hooks
- **Superpowers patterns**: Referenced enforcement techniques
