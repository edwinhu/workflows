# tinymist

Typst language support for Claude Code using [tinymist](https://github.com/Myriad-Dreamin/tinymist).

## Features

- **Typst Skill**: Comprehensive syntax guidance and best practices
- **Error Checking**: Auto-diagnose errors via VS Code or tinymist CLI
- **Visual Inspection**: Export pages as PNG to see rendered output
- **Compilation**: Build PDFs and start live preview servers

## Prerequisites

Install tinymist:

```bash
# Via Homebrew (macOS)
brew install tinymist

# Or via cargo
cargo install tinymist
```

Verify installation:

```bash
tinymist --version
```

## Skills (Claude uses automatically)

| Skill | Description |
|-------|-------------|
| `typst` | Typst syntax, templates, and best practices |
| `check` | Get errors/warnings from VS Code diagnostics or tinymist CLI |
| `screenshot` | Export page as PNG and view for visual inspection |

## Commands (invoke explicitly)

| Command | Description |
|---------|-------------|
| `/tinymist:compile` | Compile Typst file to PDF |
| `/tinymist:preview` | Start live preview server |

## Usage

### Autonomous Debugging

When you ask Claude to fix Typst issues, it will automatically:
1. Use `check` to get errors from VS Code or tinymist
2. Use `screenshot` to see the visual output
3. Apply fixes based on `typst` skill knowledge
4. Repeat until resolved

### Explicit Commands

```bash
# Build PDF
/tinymist:compile doc.typ

# Start live preview
/tinymist:preview doc.typ
```

## More Information

- [Typst Documentation](https://typst.app/docs)
- [tinymist GitHub](https://github.com/Myriad-Dreamin/tinymist)
- [Typst Packages](https://typst.app/universe)
