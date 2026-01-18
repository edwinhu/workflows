# tinymist-lsp

Typst language server integration for Claude Code using [tinymist](https://github.com/Myriad-Dreamin/tinymist).

## Features

- **LSP Integration**: Full language server support for Typst files (`.typ`)
  - Diagnostics (errors, warnings)
  - Hover information
  - Go-to-definition
  - Document symbols
  - Code completion
  - Formatting
- **Typst Skill**: Syntax guidance and best practices
- **Commands**: Compile and preview Typst documents

## Prerequisites

Install tinymist:

```bash
# Via cargo
cargo install tinymist

# Or via npm
npm install -g @aspect-build/tinymist

# Or via Homebrew (macOS)
brew install tinymist
```

Verify installation:

```bash
tinymist --version
```

## Supported Extensions

- `.typ` - Typst documents

## Commands

| Command | Description |
|---------|-------------|
| `/typst:compile` | Compile Typst file to PDF |
| `/typst:preview` | Start live preview server |

## Usage

Once installed, Claude Code will automatically:
- Provide diagnostics for Typst files
- Offer code completions
- Show hover information for functions and variables
- Enable go-to-definition navigation

Use the skill by asking about Typst syntax, templates, or best practices.

## More Information

- [Typst Documentation](https://typst.app/docs)
- [tinymist GitHub](https://github.com/Myriad-Dreamin/tinymist)
- [Typst Packages](https://typst.app/universe)
