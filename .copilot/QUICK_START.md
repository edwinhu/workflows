# Quick Start - Workflows + VS Code Copilot

## One-line install:

```bash
bash ~/projects/workflows/.copilot/install.sh
```

## Enable required settings:

> **Note:** Experimental features (VS Code 1.107+), subject to change.

Open VS Code Settings (`Ctrl+,`) and enable:
- ✓ `chat.useClaudeSkills`
- ✓ `chat.customAgentInSubagent.enabled`
- ✓ `chat.useAgentsMdFile`

**Or** add to `settings.json`:
```json
{
  "chat.useClaudeSkills": true,
  "chat.customAgentInSubagent.enabled": true,
  "chat.useAgentsMdFile": true
}
```

Then **restart VS Code**.

## What this does:

✓ Creates `~/.config/Code/User/prompts/workflows.instructions.md`
✓ Enables skills auto-discovery in every Copilot session
✓ Creates backup `AGENTS.instructions.md` for compatibility

## Verify it works:

In VS Code, chat with Copilot:
```
What workflows skills are available?
```

You should get a list of 39 skills organized by category.

## Start using skills:

Reference them in your requests:
- "Use the /dev-debug skill to investigate this crash..."
- "Apply the /dev skill to implement authentication..."
- "Use /ds skill to analyze this dataset..."

## More info:

See [INSTALL.md](./INSTALL.md) for detailed setup and troubleshooting.
