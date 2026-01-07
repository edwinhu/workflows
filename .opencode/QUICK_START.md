# OpenCode Quick Start

This is the fastest way to get workflows running in OpenCode.

## Install (30 seconds)

```bash
# Clone the branch
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows

# Symlink skills
mkdir -p ~/.config/opencode/skills
ln -sf ~/.config/opencode/workflows/.opencode/skill/* ~/.config/opencode/skills/

# Restart OpenCode
# Then load a skill:
# use_skill(skill_name="using-workflows")
```

## Load a Skill

In OpenCode:

```
use_skill(skill_name="dev-implement")
```

## Available Skills

- **dev-implement** - Orchestrate feature implementation
- **dev-debug** - Fix bugs systematically
- **dev-tdd** - Write tests first, implement second
- **dev-verify** - Check everything works
- **dev-review** - Review code quality
- **using-workflows** - Learn how to use these skills

## The Pattern

1. **Load a skill** - `use_skill(skill_name="skill-name")`
2. **Follow instructions** - Skill guides the process
3. **Spawn subagents** - Use `@mention` to delegate work
4. **Verify results** - Use `dev-verify` to check

## Most Common Use Case

### Adding a Feature

```
1. use_skill(skill_name="dev-implement")
2. Follow instructions to spawn subagent for each task
3. Subagent writes failing test, minimal code, runs tests
4. Repeat for each task
5. use_skill(skill_name="dev-review")
```

### Fixing a Bug

```
1. use_skill(skill_name="dev-debug")
2. Follow 4-phase debugging protocol
3. Spawn subagent to investigate
4. Subagent finds root cause and writes fix
5. Verify with dev-verify
```

## Key Principles

**Delegation:** You coordinate, subagents write code
**TDD:** Write test first, then implementation
**Verification:** Always verify with tests before claiming done

## Files

- **COMPATIBILITY.md** - Detailed comparison with Claude Code
- **INSTALL.md** - Installation options
- **README.md** - Overview of skills

## Help

In OpenCode, load the skill with questions:

```
use_skill(skill_name="using-workflows")
```

This teaches you how to use all the skills.

## Next

See COMPATIBILITY.md for detailed docs, or jump into OpenCode and try a skill!

