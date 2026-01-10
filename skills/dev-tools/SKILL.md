---
name: dev-tools
description: This skill should be used when the user asks to "what plugins are available", "list dev tools", "what MCP servers can I use", "enable code intelligence", or needs to discover available development plugins like serena, context7, or playwright.
---

# Available Development Plugins

These plugins extend Claude Code capabilities for development workflows. Enable when needed for specific tasks.

## Code Intelligence

| Plugin | Description | Enable Command |
|--------|-------------|----------------|
| `serena` | Semantic code analysis, refactoring, symbol navigation | `claude --enable-plugin serena@claude-plugins-official` |
| `pyright-lsp` | Python type checking and diagnostics | `claude --enable-plugin pyright-lsp@claude-plugins-official` |
| `clangd-lsp` | C/C++ code intelligence | Already enabled |

## Documentation

| Plugin | Description | Enable Command |
|--------|-------------|----------------|
| `context7` | Up-to-date library/framework docs lookup | `claude --enable-plugin context7@claude-plugins-official` |

## Testing & Automation

| Plugin | Description | Enable Command |
|--------|-------------|----------------|
| `playwright` | Browser automation, E2E testing, screenshots | `claude --enable-plugin playwright@claude-plugins-official` |

## Workflow

| Plugin | Description | Enable Command |
|--------|-------------|----------------|
| `ralph-loop` | Self-referential iteration loops | Already enabled |
| `hookify` | Create custom hooks from conversation patterns | Already enabled |

## When to Enable

- **serena**: Complex refactoring, finding symbol references, understanding large codebases
- **context7**: Need current docs for React, pandas, FastAPI, etc.
- **playwright**: Testing web UIs, scraping, taking screenshots
- **pyright-lsp**: Python projects needing strict type checking

## Usage

Enable a plugin for the current session by running:
```bash
# Enable a plugin: claude --enable-plugin <plugin-name>
claude --enable-plugin <plugin-name>
```

Enable a plugin for a project by adding to `.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "serena@claude-plugins-official": true
  }
}
```
