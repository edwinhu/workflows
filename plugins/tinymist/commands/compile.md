---
description: Compile Typst file to PDF
argument-hint: [file.typ] [output.pdf]
allowed-tools: Bash(tinymist:*), Glob, Read
---

Compile a Typst document to PDF.

Auto-detect the Typst file to compile:
1. If `$1` is provided and ends with `.typ`, use it as the input file
2. Otherwise, search for `.typ` files in the current directory using Glob
3. If multiple files found, list them and ask user to specify
4. If exactly one file found, use it automatically

Determine output filename:
1. If `$2` is provided, use it as the output path
2. Otherwise, use the input filename with `.pdf` extension

Execute compilation:
```bash
tinymist compile <input.typ> <output.pdf>
```

After compilation:
- Report success with the output file path
- If errors occur, display the error messages and suggest fixes based on tinymist diagnostics
- Mention that `/tinymist:preview` can be used for live preview while editing
