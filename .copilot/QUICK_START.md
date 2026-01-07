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

## ⚠️ IMPORTANT: Skill Chaining

Skills don't work in isolation. Each skill chains to the next phase:

```
/dev-brainstorm → /dev-explore → /dev-clarify → /dev-design → /dev-implement → /dev-review → /dev-verify
```

**After each skill completes, you MUST invoke the next one.** The instructions will tell you what to do next.

When a skill says "Continue with /dev-explore", respond with:
```
runSubagent(
  description="Explore codebase",
  prompt="Continue with /dev-explore phase using the SPEC.md from .claude/"
)
```

See the **"SKILL CHAINING IN COPILOT"** section in `workflows.instructions.md` for the full protocol.

## More info:

See [INSTALL.md](./INSTALL.md) for detailed setup and troubleshooting.
