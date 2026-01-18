---
description: Start live preview server for Typst document
argument-hint: [file.typ]
allowed-tools: Bash(tinymist:*), Glob, Read
---

Start a live preview server for a Typst document.

Auto-detect the Typst file:
1. If `$1` is provided and ends with `.typ`, use it as the input file
2. Otherwise, search for `.typ` files in the current directory using Glob
3. If multiple files found, list them and ask user to specify
4. If exactly one file found, use it automatically

Start the preview server:
```bash
tinymist preview <input.typ> --open
```

Inform the user:
- The preview will open in their default browser
- Changes to the document will automatically refresh the preview
- The server will continue running until stopped (Ctrl+C)
- Preview supports both document and slide modes (`--preview-mode slide` for presentations)

If the user wants to customize the preview:
- `--partial-rendering true` for better performance on large documents
- `--invert-colors auto` for dark mode compatibility
- `--ppi <number>` to adjust resolution (default: 144)
