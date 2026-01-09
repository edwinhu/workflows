# Jupytext PostToolUse Hook

Automatically syncs paired notebooks and runs language-specific linters after editing jupytext files.

## How It Works

1. **Detection**: Triggers on files with `# %%` markers or `jupyter:` metadata
2. **Sync**: Runs `uvx jupytext --sync` to keep `.py`/`.R`/`.do` ↔ `.ipynb` in sync
3. **Lint**: Runs appropriate linter based on kernel/language
4. **Report**: Shows sync status and lint issues (non-blocking)

## Supported Languages

| Language | Linter | Detection |
|----------|--------|-----------|
| Python | ruff, black, mypy | From `pixi.toml` |
| R | lintr | From tidyverse/lintr package |
| Stata | stata-linter | Global install |
| SAS | sasjs lint | Global install |

## What It Catches

**Sync issues:**
- Paired files out of sync (`.py` edited but `.ipynb` stale)
- Missing paired files
- Jupytext format errors

**Lint issues (language-specific):**
- Python: Style violations (ruff), formatting (black), type errors (mypy)
- R: Style and syntax issues (lintr)
- Stata: Code quality issues (stata-linter)
- SAS: Code quality issues (sasjs lint)

## Examples

### Success with sync
```python
# Edit notebooks/analysis.py
# %%
import pandas as pd
df = pd.read_csv("data.csv")
```

Hook output:
```
✓ Synced analysis.py with paired notebook
```

### Sync + lint issues
```python
# Edit with style violations
# %%
x=1+2  # No spaces around operators
```

Hook output:
```
✓ Synced analysis.py with paired notebook

⚠️ Linting issues found:
  • ruff: E225 Missing whitespace around operator
  • black: File would be reformatted
```

### R file with lintr issues
```r
# %%
x <- function( y ){  # Bad spacing
  return(y+1)
}
```

Hook output:
```
✓ Synced analysis.R with paired notebook

⚠️ Linting issues found:
  • lintr: Unnecessary spacing in function definition
```

## Design Principles

**Silent on success:**
- Only reports when files are actually synced or issues found
- No noise for files that don't need syncing

**Non-blocking:**
- Warnings only, never prevents edits
- Sync happens even if linting fails

**Language-aware:**
- Automatically detects kernel from file extension and metadata
- Only runs linters that are available in the environment

**Fast path:**
- Exits immediately for non-jupytext files
- Skips linting if sync fails

## Linter Setup

### Python (via pixi)

Add to `pixi.toml`:
```toml
[dependencies]
ruff = ">=0.1.0"
black = ">=23.0.0"
mypy = ">=1.0.0"
```

The hook automatically detects and uses available linters.

### R (via package)

```r
install.packages("lintr")
# Or if using tidyverse
install.packages("tidyverse")  # Includes lintr
```

### Stata

```bash
npm install -g @worldbank/stata-linter
```

Or see: https://github.com/worldbank/stata-linter

### SAS

```bash
npm install -g @sasjs/cli
```

Or see: https://github.com/sasjs/lint

## Integration

Registered in `/hooks/hooks.json`:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/jupytext/jupytext-sync.py"
      }
    ]
  }
]
```

## Requirements

- `uv` must be installed (provides `uvx` command)
- **No jupytext installation required** - uvx fetches it automatically
- Linters are optional - hook runs without them

## Testing

Test with included example files:

```bash
# Python notebook sync
cd hooks/scripts/jupytext
echo '{"tool_name": "Edit", "tool_input": {"file_path": "test_python.py"}}' | python3 jupytext-sync.py

# R notebook sync
echo '{"tool_name": "Edit", "tool_input": {"file_path": "test_r.R"}}' | python3 jupytext-sync.py
```

## Comparison to Pre-commit Hook

This hook provides similar functionality to jupytext's pre-commit hook but:

- **Runs immediately** after edits (not just at commit time)
- **Provides feedback** in the main conversation
- **Includes linting** for multi-language projects
- **Non-blocking** (doesn't prevent commits)

For CI/CD, still recommend using the official pre-commit hook.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Sync not running | Check file has `# %%` or `jupyter:` metadata |
| Linter not found | Install globally or add to pixi.toml |
| Timeout | Large notebooks may need longer timeout |
| Wrong kernel detected | Add kernelspec header to file |

## Related

- **`skills/jupytext/SKILL.md`** - Behavioral guidance for jupytext workflows
- **`hooks/scripts/marimo/marimo-check.py`** - Similar hook for marimo notebooks
