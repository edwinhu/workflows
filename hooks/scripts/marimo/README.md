# Marimo PostToolUse Hook

Validates marimo notebooks after `Edit` or `Write` operations to catch structural errors early.

## How It Works

1. **Detection**: Only triggers on Python files containing both `import marimo` AND `@app.cell`
2. **Validation**: Runs `uvx marimo check <notebook.py>` after each edit (no installation required!)
3. **Reporting**: Shows warnings for errors (non-blocking)
4. **Fast path**: Exits immediately for non-marimo files

## What It Catches

The hook validates marimo notebook structure and catches:

- **Multiple definitions**: Same variable defined in multiple cells
- **Syntax errors**: Invalid Python syntax in cells
- **Invalid cell structure**: Malformed `@app.cell` decorators
- **Parsing errors**: Notebook format issues
- **Formatting issues**: Code style problems (when used with `--fix` flag)

marimo check provides fast, pre-execution validation of notebook structure and common errors.

## Examples

### Success (silent)
```python
import marimo
app = marimo.App()

@app.cell
def _(pd):
    df = pd.read_csv("data.csv")
    return df,  # ✓ Variable returned
```

Hook: *(no output - check passed)*

### Error (warning shown)
```python
import marimo
app = marimo.App()

@app.cell
def _():
    a = 1  # ✗ First definition
    return a,

@app.cell
def _():
    a = 1  # ✗ Second definition - ERROR!
    return a,
```

Hook output:
```
⚠️ marimo check found issues in notebook.py:

critical[multiple-definitions]: Variable 'a' is defined in multiple cells
hint: Variables must be unique across cells. Alternatively, they can be private with an underscore prefix (i.e. `_a`.)

Fix these before running the notebook.
```

## Design Principles

**Non-intrusive:**
- Only runs on actual marimo notebooks (checks for `import marimo`)
- Silent on success (no noise)
- Non-blocking (warnings only)
- Fast (<100ms for typical notebooks)

**Mechanical enforcement:**
- Catches deterministic errors that behavioral guidance can miss
- Provides immediate feedback (no need to run notebook first)
- Complements existing marimo skill behavioral patterns

## Testing

Test with the included `test_notebook.py`:

```bash
# Manual test of the script
cd hooks/scripts/marimo
echo '{"tool_name": "Edit", "tool_input": {"file_path": "test_notebook.py"}}' | python3 marimo-check.py
```

The test notebook has a deliberate error (missing return statement) to verify the hook works.

## Integration

Registered in `/hooks/hooks.json`:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/marimo/marimo-check.py"
      }
    ]
  }
]
```

## Requirements

- `uv` must be installed (provides `uvx` command)
- **No marimo installation required** - uvx fetches it automatically on first use
- If uvx is not found, the hook reports this gracefully with installation link
- Works with marimo 0.6.0+

## Related

- **`skills/marimo/SKILL.md`** - Behavioral guidance for marimo development
- **`hooks/scripts/common/dispatcher.py`** - PreToolUse workflow enforcement
