# Compatibility & Known Issues

This document describes known compatibility issues and workarounds when using workflows with GitHub Copilot in VS Code.

## VS Code Version Requirements

| Component | Minimum | Tested | Notes |
|-----------|---------|--------|-------|
| VS Code | 1.85+ | 1.95+ | Custom prompt files require v1.85+ |
| Copilot Extension | 1.150+ | Latest | Earlier versions don't load custom prompts |

Check your version:
- VS Code: `Code > About Visual Studio Code`
- Copilot: `VS Code > Extensions > GitHub Copilot > Version`

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Intel) | ✓ Supported | Tested on 13.0+ |
| macOS (Apple Silicon) | ✓ Supported | Tested on 13.0+ |
| Linux | ✓ Supported | Tested on Ubuntu 22.04+ |
| Windows | ✓ Supported | Tested on Windows 11 |
| WSL (Windows Subsystem for Linux) | ⚠ Partial | Path differences require adjustment |

## Known Issues & Workarounds

### Issue 1: Prompts not loading on startup

**Symptom:** Skills aren't mentioned in the first Copilot message

**Cause:** VS Code occasionally needs a full reload of the Copilot extension

**Workaround:**
1. Close VS Code completely
2. Wait 5 seconds
3. Reopen VS Code
4. Start a new Copilot conversation

**Alternative:** Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run:
```
GitHub Copilot: Reset Copilot
```

### Issue 2: Paths don't resolve correctly

**Symptom:** Error like "Cannot find ~/projects/workflows/skills"

**Cause:** Home directory expansion doesn't work in some contexts

**Workaround:** Use absolute paths in your requests:
```
List the skills in /home/edwinhu/projects/workflows/skills/
```

Or on macOS:
```
List the skills in /Users/edwinhu/projects/workflows/skills/
```

### Issue 3: Skills installation on WSL

**Symptom:** Script creates files in Windows path instead of Linux

**Cause:** WSL path mapping differences

**Workaround:** Run install script inside WSL terminal:
```bash
# From WSL terminal, NOT Windows
bash ~/projects/workflows/.copilot/install.sh
```

Verify with:
```bash
wsl ls ~/.config/Code/User/prompts/
```

### Issue 4: Permission denied on install.sh

**Symptom:** `bash: ./install.sh: Permission denied`

**Cause:** File doesn't have execute permissions

**Workaround:**
```bash
chmod +x ~/projects/workflows/.copilot/install.sh
bash ~/projects/workflows/.copilot/install.sh
```

### Issue 5: Copilot suggests `Skill()` or `use_skill()` commands

**Symptom:** Copilot says to use `Skill(skill="dev-debug")` instead of `/dev-debug`

**Cause:** Copilot is confusing VS Code Copilot with Claude Code or OpenCode

**Workaround:** Clarify in your request:
```
Use the dev-debug skill (from workflows) to investigate this error...
```

Or explicitly mention:
```
I'm using GitHub Copilot in VS Code, not Claude Code. Use the /dev-debug skill...
```

### Issue 6: Multiple prompt files conflict

**Symptom:** Conflicting instructions or confusion about which skills apply

**Cause:** Multiple `.instructions.md` files in `~/.config/Code/User/prompts/`

**Workaround:** 
1. Check what's in the directory:
   ```bash
   ls ~/.config/Code/User/prompts/
   ```

2. Remove conflicting files:
   ```bash
   rm ~/.config/Code/User/prompts/old-instructions.md
   ```

3. Keep only:
   - `workflows.instructions.md` (main)
   - `AGENTS.instructions.md` (backup/compatibility)

4. Restart VS Code

### Issue 7: Paths with spaces fail

**Symptom:** Errors when project path contains spaces

**Cause:** Skill instructions reference paths that need quoting

**Workaround:** Always quote paths in conversations:
```
Analyze the file "/Users/user name/My Project/src/index.ts"
```

### Issue 8: Skills available but Copilot doesn't use them

**Symptom:** Correct instruction file exists but Copilot doesn't reference skills

**Cause:** This can be normal behavior—Copilot applies skills implicitly

**Check if it's working:**
- Mention a bug → does Copilot ask debugging questions?
- Request a feature → does Copilot suggest implementation approach?
- Ask for data analysis → does Copilot structure analysis?

If yes, skills are working but not explicitly mentioned. This is expected.

To force explicit reference:
```
Use the /dev-debug skill to help me with this crash...
```

## Integration Issues

### With Remote Extensions

**Symptom:** Skills work locally but not when using SSH or Remote-Containers

**Status:** Works in VS Code Remote extensions

**Workaround:** Install the prompt files inside the remote environment:

```bash
# SSH into remote
ssh user@host

# Run install script on remote
bash ~/projects/workflows/.copilot/install.sh
```

### With VS Code Settings Sync

**Symptom:** Prompt files sync incorrectly between machines

**Status:** Known limitation—prompt files are user-local, not synced

**Workaround:** Run install script on each machine:
```bash
bash ~/projects/workflows/.copilot/install.sh
```

Or manually copy:
```bash
cp ~/.config/Code/User/prompts/workflows.instructions.md /path/to/other/machine/
```

### With Other Prompt Files

**Symptom:** Other instruction files interfere with workflows

**Status:** All `.instructions.md` files in `~/.config/Code/User/prompts/` are merged

**Workaround:** Review naming to avoid conflicts:
- `workflows.instructions.md` - workflows primary
- `AGENTS.instructions.md` - workflows backup
- `custom.instructions.md` - your custom instructions (if any)

Keep names descriptive to avoid overwriting.

## Copycat Issues

### Skills vs. Built-in Suggestions

**Symptom:** Copilot suggests built-in patterns instead of using workflow skills

**This is expected.** Workflows skills are:
- Opinionated methodology guides
- Best for complex tasks (debugging, implementation phases)
- Not always used for simple queries

They're most effective when you mention a problem area that matches a trigger.

## Troubleshooting Checklist

Use this if something isn't working:

- [ ] VS Code version 1.85+? (`Code > About`)
- [ ] Copilot extension 1.150+? (`Extensions > GitHub Copilot`)
- [ ] Run install script? (`bash ~/.copilot/install.sh`)
- [ ] Restart VS Code? (Close completely and reopen)
- [ ] Check file exists? (`ls ~/.config/Code/User/prompts/workflows.instructions.md`)
- [ ] Check file has content? (`cat ~/.config/Code/User/prompts/workflows.instructions.md | wc -l`)
- [ ] Workflows repo cloned? (`ls ~/projects/workflows/skills | wc -l` should show ~39)

## Version History

### v1.0 (Jan 2026)
- Initial VS Code support
- 39 available skills
- Tested on VS Code 1.85+
- Supports macOS, Linux, Windows

### Changes from OpenCode Setup

If you're migrating from OpenCode to VS Code:

| Aspect | OpenCode | VS Code |
|--------|----------|---------|
| Plugin system | Yes, required | No, simpler prompt files |
| Symlink skills | Yes | No, read from repo |
| Per-project skills | `.opencode/skill/` | `.vscode/instructions.md` |
| Update method | `git pull` | `git pull` (same) |
| Re-install after update | Optional (symlinks) | Run script if prompts change |

## Getting Help

If you encounter issues not listed here:

1. Check the [INSTALL.md](./INSTALL.md) troubleshooting section
2. Review the [README.md](./README.md) for architecture details
3. File an issue: https://github.com/edwinhu/workflows/issues
4. Include:
   - VS Code version and platform
   - Copilot extension version
   - Output from: `bash ~/projects/workflows/.copilot/install.sh`
   - Example of what doesn't work

## Contributing

If you discover and solve a compatibility issue:

1. Document the issue and workaround
2. Submit a PR updating this file
3. Include reproduction steps and solution

