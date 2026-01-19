---
name: check
description: Check Typst files for errors. Use when debugging Typst compilation errors, investigating why a document fails to compile, or when the user mentions errors in their .typ files.
version: 1.0.0
---

# Check Typst Files for Errors

Use this skill to get diagnostics (errors, warnings) from Typst files.

## Error Sources (try in order)

### 1. VS Code Diagnostics (preferred when in VS Code)

If `mcp__ide__getDiagnostics` is available, use it first:
- Returns real-time LSP diagnostics from tinymist running in VS Code
- Includes errors, warnings, and hints with line/column locations
- No need to save the file first

### 2. Tinymist CLI (fallback)

If VS Code diagnostics unavailable, run tinymist directly:

```bash
tinymist compile --check <file.typ> 2>&1
```

Note: `--check` validates without producing output PDF.

## Auto-detect file

1. If a specific `.typ` file is mentioned, use it
2. Otherwise, search for `.typ` files in current directory using Glob
3. If multiple files found, check the most recently modified or ask user
4. If exactly one file found, use it automatically

## Output format

Report diagnostics clearly:
- Group by severity (errors first, then warnings)
- Include file path, line number, column
- Quote the problematic code if possible
- Suggest fixes based on the `/typst` skill knowledge

## Common errors and fixes

- “Unknown variable” → Check spelling, ensure `#let` before use
- “Expected content” → Wrap value in brackets: `[#value]`
- “Cannot apply” → Check function signature and argument types
- “Unexpected end” → Check for unclosed brackets `{`, `[`, `(`
