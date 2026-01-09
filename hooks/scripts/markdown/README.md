# Markdown PostToolUse Hook

Validates markdown files for common rendering issues after `Edit` or `Write` operations.

## How It Works

1. **Detection**: Triggers on `.md`, `.markdown`, `.mdown`, `.mkdn` files
2. **Validation**: Checks for unescaped dollar signs that trigger LaTeX rendering
3. **Reporting**: Shows warnings for issues (non-blocking)
4. **Fast path**: Exits immediately for non-markdown files

## What It Catches

**Unescaped dollar signs:**
- `$` characters outside of backticks or code blocks
- Common in: environment variables (`$HOME`), currency (`$50`), shell variables
- Problem: Triggers LaTeX math mode in GitHub, Obsidian, most modern renderers

## Examples

### Error (warning shown)
```markdown
# Cost Analysis

The project cost is $50 per user.
Set the $HOME variable to configure the path.
```

Hook output:
```
⚠️ Found 2 line(s) with unescaped $ in analysis.md:

Dollar signs trigger LaTeX rendering. Wrap them in backticks:

  Line 3: The project cost is $50 per user.
  Line 4: Set the $HOME variable to configure the path.

Examples:
  ❌ The cost is $50        ✅ The cost is `$50`
  ❌ Set $HOME variable     ✅ Set `$HOME` variable
```

### Success (silent)
```markdown
# Cost Analysis

The project cost is `$50` per user.
Set the `$HOME` variable to configure the path.

Math is allowed in code blocks:
```bash
total=$price * $quantity
```
```

Hook: *(no output - check passed)*

## Design Principles

**Non-intrusive:**
- Only runs on actual markdown files
- Silent on success (no noise)
- Non-blocking (warnings only)
- Fast (<50ms for typical files)

**Mechanical enforcement:**
- Catches deterministic errors that behavioral guidance can miss
- Provides immediate feedback after edits
- Complements skill-based behavioral patterns

**Smart detection:**
- Ignores `$` inside backticks (inline code)
- Ignores `$` inside code blocks (``` or ~~~)
- Ignores already-escaped `\$`
- Handles both single-line and multi-line code blocks

## Integration

Registered in `/hooks/hooks.json`:

```json
"PostToolUse": [
  {
    "matcher": "Edit|Write",
    "hooks": [
      {
        "type": "command",
        "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/markdown/markdown-check.py"
      }
    ]
  }
]
```

## Requirements

- Python 3.7+
- No external dependencies (uses stdlib only)

## Testing

Test with a sample markdown file:

```bash
cd hooks/scripts/markdown

# Create test file with unescaped dollars
echo '# Test
The cost is $50 and the path is $HOME' > test.md

# Test the hook
echo '{"tool_name": "Edit", "tool_input": {"file_path": "test.md"}}' | python3 markdown-check.py
```

## Related

- **`hooks/scripts/marimo/marimo-check.py`** - Also checks markdown in `mo.md()` calls
- **`hooks/scripts/jupytext/jupytext-sync.py`** - Also checks markdown in `# %% [markdown]` cells
- **`hooks/scripts/common/markdown_validators.py`** - Shared validation logic

## Why This Matters

**Universal issue across renderers:**
- GitHub README files
- Obsidian notes
- Jupyter/marimo/jupytext markdown cells
- Documentation sites (MkDocs, Docusaurus, etc.)

**Common mistakes:**
- Writing `$50` instead of `\`$50\``
- Writing `$HOME` instead of `\`$HOME\``
- Not realizing $ triggers LaTeX `$...$` math mode

**Impact without escaping:**
- Text disappears or renders strangely
- Breaks on different platforms
- Confusing for readers
