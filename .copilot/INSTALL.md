# Installing Workflows for GitHub Copilot (VS Code)

The workflows library provides 39 skills for software development, data science, and writing workflows. This guide shows how to install and set up workflows for GitHub Copilot in VS Code.

## Quick Start (Automated)

Run this command in your terminal:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/edwinhu/workflows/main/.copilot/install.sh)
```

Or if you have the repo cloned locally:

```bash
bash ~/projects/workflows/.copilot/install.sh
```

This automated installer will:
1. Create the prompt configuration directory
2. Install the workflows instruction file 
3. Verify installation

**Then:**
1. Enable required VS Code settings (see below)
2. Restart VS Code and skills are ready to use

### Required Settings After Installation

After running the installer, enable these settings in VS Code:

> **Note:** These settings are experimental features as of VS Code 1.107 and may change in future releases.

1. Open Settings: `Ctrl+,` (or `Cmd+,` on Mac)
2. Search for and enable each setting:
   - ✓ `chat.useClaudeSkills`
   - ✓ `chat.customAgentInSubagent.enabled`
   - ✓ `chat.useAgentsMdFile`

Or add to your `settings.json`:

```json
{
  "chat.useClaudeSkills": true,
  "chat.customAgentInSubagent.enabled": true,
  "chat.useAgentsMdFile": true
}
```

See the [Manual Installation](#manual-installation) section below for full details.

---

## Prerequisites

- GitHub Copilot extension installed in VS Code
- Git installed (for cloning the repository)
- Terminal/shell access

## Manual Installation

### Step 1: Clone the workflows repository (if not already done)

```bash
git clone https://github.com/edwinhu/workflows.git ~/projects/workflows
```

Or update existing clone:

```bash
cd ~/projects/workflows
git pull origin main
```

### Step 2: Create the prompt directory

```bash
mkdir -p ~/.config/Code/User/prompts
```

### Step 3: Create the workflows instruction file

Create `~/.config/Code/User/prompts/workflows.instructions.md`:

```bash
cat > ~/.config/Code/User/prompts/workflows.instructions.md << 'INSTRUCTIONS'
---
applyTo: '**'
---

# Using Workflows Skills

**CRITICAL: Read this at the start of EVERY new session.**

## Skills Location

All available skills are located in: `~/projects/workflows/skills/`

**At the start of each session, you MUST:**
1. List all skills: `ls ~/projects/workflows/skills/`
2. Familiarize yourself with available skills for the session

## The Rule

**Invoke relevant skills BEFORE any response or action.**

This is non-negotiable. Even a 1% chance a skill applies requires checking.

\`\`\`
User message arrives
    ↓
Check: Does this match any skill trigger?
    ↓
YES → Invoke skill FIRST, then follow its protocol
NO  → Proceed normally
\`\`\`

## Skill Triggers

| User Intent | Skill | Trigger Words |
|-------------|-------|---------------|
| Bug/fix | `/dev-debug` | bug, broken, fix, doesn't work, crash, error, fails |
| Feature/implement | `/dev` | add, implement, create, build, feature |
| Data analysis | `/ds` | analyze, data, model, dataset, statistics |
| Writing | `/writing` | write, draft, document, essay, paper |

## Red Flags - You're Skipping the Skill Check

If you think any of these, STOP:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Simple questions don't involve reading code |
| "I'll gather information first" | That IS investigation - use the skill |
| "I know exactly what to do" | The skill provides structure you'll miss |
| "It's just one file" | Scope doesn't exempt you from scope |
| "Let me quickly check..." | "Quickly" means skipping the workflow |

## Bug Reports - Mandatory Response

When user mentions a bug:

\`\`\`
1. DO NOT read code files
2. DO NOT investigate  
3. DO NOT "take a look"

INSTEAD:
1. Start investigation with /dev-debug skill
2. Inside skill, follow the protocol
\`\`\`

**Any code reading before starting the workflow is a violation.**

## Skill Priority

When multiple skills could apply:

1. **Process skills first** - debugging, brainstorming determine approach
2. **Then implementation** - dev, ds, writing execute the approach

## How to Invoke Skills

Use the `runSubagent` tool with skill names:

\`\`\`
runSubagent(
  description="Brief 3-5 word task description",
  prompt="Use the /dev-debug skill to investigate..."
)
\`\`\`

Or reference skills directly in prompts:
- `/dev-debug` for debugging issues
- `/dev` for implementation
- `/ds` for data science
- `/writing` for writing tasks

**Note:** In VS Code Copilot, use `runSubagent` (not `Task()` from other platforms like Claude Code)

## Available Skills

See all skills:

\`\`\`bash
ls ~/projects/workflows/skills/
\`\`\`

Main categories:
- **Development:** `dev`, `dev-debug`, `dev-implement`, `dev-tdd`, `dev-test`, `dev-review`, `dev-design`, `dev-brainstorm`
- **Data Science:** `ds`, `ds-implement`, `ds-brainstorm`, `ds-plan`, `ds-verify`
- **Writing:** `writing`, `writing-brainstorm`, `writing-econ`, `writing-legal`
- **Specialized:** `ai-anti-patterns`, `notebook-debug`, `jupytext`, `marimo`, `using-skills`

## Verification

In VS Code, start a new conversation and ask GitHub Copilot to list the skills.
INSTRUCTIONS
```

### Step 4: Enable Required Settings

For workflows skills to function properly in VS Code, you need to enable several experimental settings:

> **⚠️ Experimental Features:** These settings are experimental as of VS Code 1.107 and subject to change in future releases. Check the [VS Code release notes](https://code.visualstudio.com/updates) for updates.

1. Open VS Code Settings (Ctrl+, or Cmd+, on Mac)
2. Enable the following settings by searching for each one:

**Required Settings:**

- `chat.useClaudeSkills` ✓ **Enable** - Allows VS Code to discover and use Claude skills
- `chat.customAgentInSubagent.enabled` ✓ **Enable** - Allows running custom subagents (required for /dev, /ds workflows)

**Custom Instructions Support (choose one method):**

Option A: Using AGENTS.md file (simpler):
- `chat.useAgentsMdFile` ✓ **Enable** - Enable support for AGENTS.md files

Option B: Using .github/copilot-instructions.md file:
- `github.copilot.chat.codeGeneration.useInstructionFiles` ✓ **Enable** - Enable .github/copilot-instructions.md support

**Optional but Recommended:**
- `chat.useNestedAgentsMdFiles` ✓ **Enable** - Support for AGENTS.md files in subfolders

**Alternative: Add to settings.json**

Open your `settings.json` (Ctrl+Shift+P → "Preferences: Open User Settings (JSON)") and add:

```json
{
  "chat.useClaudeSkills": true,
  "chat.customAgentInSubagent.enabled": true,
  "chat.useAgentsMdFile": true,
  "chat.useNestedAgentsMdFiles": true
}
```

### Step 5: Restart VS Code

Close and reopen VS Code. The new instruction file and settings will be loaded in your next Copilot conversation.

## Verification

In VS Code, open a new conversation with GitHub Copilot and ask:
```
List the workflows skills
```

You should get a response showing the 39 skills available in `~/projects/workflows/skills/`.

## Additional Configuration (Optional)

### Use in Specific Workspaces Only

If you want workflows skills only in certain projects, create a local instruction file:

```bash
# In your project root
mkdir -p .vscode
cat > .vscode/instructions.md << 'EOF'
---
applyTo: '**'
---

# Local Workflows Skills

This project uses the workflows skill system. See: ~/.config/Code/User/prompts/workflows.instructions.md
