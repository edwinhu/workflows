#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKFLOWS_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo -e "${YELLOW}Installing workflows for GitHub Copilot (VS Code)${NC}"
echo ""

# Step 1: Create prompt directory
echo "Step 1: Creating prompt configuration directory..."
mkdir -p ~/.config/Code/User/prompts
echo -e "${GREEN}✓ Created ~/.config/Code/User/prompts${NC}"

# Step 2: Create workflows instruction file
echo ""
echo "Step 2: Installing workflows instruction file..."

PROMPT_FILE="$HOME/.config/Code/User/prompts/workflows.instructions.md"

# Read the using-skills SKILL.md and create the instruction file
cat > "$PROMPT_FILE" << 'INSTRUCTIONS'
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

```
User message arrives
    ↓
Check: Does this match any skill trigger?
    ↓
YES → Invoke skill FIRST, then follow its protocol
NO  → Proceed normally
```

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

```
1. DO NOT read code files
2. DO NOT investigate  
3. DO NOT "take a look"

INSTEAD:
1. Start investigation with /dev-debug skill
2. Inside skill, follow the protocol
```

**Any code reading before starting the workflow is a violation.**

## Skill Priority

When multiple skills could apply:

1. **Process skills first** - debugging, brainstorming determine approach
2. **Then implementation** - dev, ds, writing execute the approach

## How to Invoke Skills

Use the `runSubagent` tool with skill names:

```
runSubagent(
  description="Brief 3-5 word task description",
  prompt="Use the /dev-debug skill to investigate..."
)
```

Or reference skills directly in prompts:
- `/dev-debug` for debugging issues
- `/dev` for implementation
- `/ds` for data science
- `/writing` for writing tasks

**Note:** In VS Code Copilot, use `runSubagent` (not `Task()` from other platforms like Claude Code)

## Available Skills

See all skills:

```bash
ls ~/projects/workflows/skills/
```

Main categories:
- **Development:** `dev`, `dev-debug`, `dev-implement`, `dev-tdd`, `dev-test`, `dev-review`, `dev-design`, `dev-brainstorm`
- **Data Science:** `ds`, `ds-implement`, `ds-brainstorm`, `ds-plan`, `ds-verify`
- **Writing:** `writing`, `writing-brainstorm`, `writing-econ`, `writing-legal`
- **Specialized:** `ai-anti-patterns`, `notebook-debug`, `jupytext`, `marimo`, `using-skills`

## Verification

In VS Code, start a new conversation and ask GitHub Copilot to list the skills.
INSTRUCTIONS

echo -e "${GREEN}✓ Created $PROMPT_FILE${NC}"

# Step 3: Verify installation
echo ""
echo "Step 3: Verifying installation..."

if [ -f "$PROMPT_FILE" ]; then
    echo -e "${GREEN}✓ workflows.instructions.md installed${NC}"
else
    echo -e "${RED}✗ Failed to create workflows.instructions.md${NC}"
    exit 1
fi

# Verify skills directory exists
if [ -d "$WORKFLOWS_DIR/skills" ]; then
    SKILL_COUNT=$(ls "$WORKFLOWS_DIR/skills" | wc -l)
    echo -e "${GREEN}✓ Found $SKILL_COUNT skills in $WORKFLOWS_DIR/skills${NC}"
else
    echo -e "${YELLOW}⚠ Skills directory not found at $WORKFLOWS_DIR/skills${NC}"
fi

# Final summary
echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Restart VS Code"
echo "2. Open a new conversation with GitHub Copilot"
echo "3. Skills should now be available in every session"
echo ""
echo "To verify, ask Copilot: 'List the workflows skills'"
echo ""
echo "For more information, see: $WORKFLOWS_DIR/.copilot/INSTALL.md"
