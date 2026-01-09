# Code Search Tools for Exploration

**Prefer semantic search over text search when exploring code.**

## ast-grep (sg) - Semantic Code Search

Use `sg` for precise code pattern matching using AST:

```bash
# Find function calls
sg -p 'foo($$$)' --lang python

# Find function definitions
sg -p 'def $FUNC($$$):' --lang python

# Find class definitions
sg -p 'class $NAME { $$$ }' --lang typescript

# Find struct usage (Go/Rust/C)
sg -p 'zathura_page_t' --lang c

# Find method calls on specific types
sg -p '$OBJ.render($$$)' --lang python
```

**When to use ast-grep vs grep:**

| Use ast-grep | Use grep |
|--------------|----------|
| Find function calls/definitions | Find text in comments/strings |
| Find class/struct usage | Find config values |
| Trace method invocations | Search non-code files |
| Refactor patterns | Quick keyword search |

## ripgrep-all (rga) - Search Everything

Use `rga` when you need to search inside:
- PDFs, Word docs, Excel, PowerPoint
- Zip/tar archives
- SQLite databases
- Images (OCR)

```bash
# Search inside PDFs
rga "pattern" docs/

# Search with context
rga -C 3 "error handling" .

# Limit to specific types
rga --type pdf "methodology" papers/
```

## Additional Resources

For more advanced ast-grep patterns, see:
- ast-grep documentation: https://ast-grep.github.io/
- Language-specific pattern syntax
- Custom rule creation
