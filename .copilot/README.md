# Workflows for GitHub Copilot (VS Code)

This directory contains installation and setup files for integrating the workflows skill system with GitHub Copilot in Visual Studio Code.

## Files

| File | Purpose |
|------|---------|
| `INSTALL.md` | Comprehensive installation and setup guide |
| `QUICK_START.md` | One-minute quick start |
| `install.sh` | Automated installation script |
| `COMPATIBILITY.md` | Known issues and compatibility notes |
| `README.md` | This file |

## Quick Install

```bash
bash ~/projects/workflows/.copilot/install.sh
```

Restart VS Code and you're done.

## How It Works

1. **Installation** creates a prompt instruction file at:
   ```
   ~/.config/Code/User/prompts/workflows.instructions.md
   ```

2. **VS Code auto-loads** this file at the start of every Copilot session

3. **Skills auto-discovery** - the prompt teaches Copilot about available skills and when to use them

4. **Repeatable setup** - new machines/reinstalls just run the install script

## What Gets Installed

- **Single file:** `~/.config/Code/User/prompts/workflows.instructions.md` - Main instruction file
- **Source:** `~/projects/workflows/skills/` - The 39 skills (already in repo)

## Key Difference from .opencode

| Aspect | .opencode | .copilot |
|--------|-----------|---------|
| **Install target** | `~/.config/opencode/` | `~/.config/Code/User/prompts/` |
| **Skill loading** | OpenCode plugin system | Instruction file injection |
| **Symlinks** | Yes, to auto-update skills | No, skills read from repo |
| **Discovery** | Manual `find_skills` command | Automatic at session start |
| **Per-project skills** | Supported (`.opencode/skill/`) | Via `.vscode/instructions.md` |

## Architecture

### VS Code Prompt Files

VS Code loads instruction files from `~/.config/Code/User/prompts/` automatically. The filename doesn't matter (e.g., `workflows.instructions.md`), they all get loaded.

**Key advantage:** This is simpler than the OpenCode plugin system—no plugin installation needed.

**Key limitation:** All matching prompt files are merged, so naming is important to avoid conflicts.

### The Instruction File

The `workflows.instructions.md` file contains:
1. Front matter: `applyTo: '**'` (applies to all chats)
2. Skill discovery instructions
3. Trigger rules for when to invoke skills
4. Available skill list

This is **not** a copy of individual skills—it teaches Copilot *how* to use skills.

### Skill Discovery

Every session, the prompt tells Copilot to check if the user's request matches a skill trigger:
- **Bug mention** → invoke `/dev-debug` skill
- **Feature request** → invoke `/dev` skill  
- **Data analysis** → invoke `/ds` skill
- **Writing task** → invoke `/writing` skill

## Updating

### To update skills:

```bash
cd ~/projects/workflows
git pull origin main
```

No re-installation needed—skills are read directly from the repo.

### To update the instruction file:

```bash
bash ~/projects/workflows/.copilot/install.sh
```

## Troubleshooting

### Skills not loading

**Check 1:** File exists in right location
```bash
ls ~/.config/Code/User/prompts/workflows.instructions.md
```

**Check 2:** Restart VS Code (fully close and reopen)

**Check 3:** Verify VS Code prompt loading is enabled
- Open Settings: `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
- Search for "prompt"
- Ensure custom prompt paths are configured

### Install script fails

**Check:** Workflows repo is cloned
```bash
ls ~/projects/workflows/.copilot/install.sh
```

If not cloned:
```bash
git clone https://github.com/edwinhu/workflows.git ~/projects/workflows
```

### Copilot doesn't mention skills

This is normal—skills are in the instruction file but Copilot doesn't always explicitly mention them. They're working if:
- You mention a bug and Copilot follows debugging methodology
- You ask for a feature and Copilot structures implementation
- Data science requests get analytical structure

## Configuration

### Customize skill triggers

Edit `~/.config/Code/User/prompts/workflows.instructions.md` to adjust trigger words or skill mappings.

### Project-specific skills

In your project root, create `.vscode/instructions.md` to override or extend the global setup:

```markdown
---
applyTo: '**'
---

# Project-Specific Skills

This project uses custom skill mappings...
```

## Contributing

To contribute improvements to the VS Code setup:

1. Edit files in `~/projects/workflows/.copilot/`
2. Test locally
3. Submit PR to the main repository

## For OpenCode Users

If you use both OpenCode and VS Code:

- **OpenCode skills:** Managed by `~/.config/opencode/` (see `.opencode/INSTALL.md`)
- **VS Code skills:** Managed by `~/.config/Code/User/prompts/` (this directory)

They're independent and can be installed together.

## Next Steps

- [QUICK_START.md](./QUICK_START.md) - 60-second setup
- [INSTALL.md](./INSTALL.md) - Detailed installation guide
- [COMPATIBILITY.md](./COMPATIBILITY.md) - Known issues

See also: `../README.md` for the workflows project overview.
