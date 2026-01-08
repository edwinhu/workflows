# OpenCode Compatibility Guide

This branch (`opencode-compatibility`) adds full support for [OpenCode](https://opencode.ai), the open source AI coding agent. Both Claude Code and OpenCode now use a unified `/skills/` directory, eliminating duplication while maintaining backward compatibility.

## Quick Start

### For OpenCode Users

1. **Clone this branch into your OpenCode config:**

```bash
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows
```

2. **Create symlinks to skills:**

```bash
mkdir -p ~/.config/opencode/skills
ln -sf ~/.config/opencode/workflows/.opencode/skill/* ~/.config/opencode/skills/
```

3. **Verify installation:**

Open OpenCode and load a skill:
```
use_skill(skill_name="using-workflows")
```

### For Claude Code Users

Nothing changes. Continue using the Claude Code plugin as before:

```
/plugin marketplace add edwinhu/workflows
/plugin install workflows
```

The `opencode-compatibility` branch doesn't affect the main branch or Claude Code plugin.

## Architecture

### Directory Structure (Unified Model)

```
workflows/
├── .claude-plugin/             # Claude Code plugin config
│   ├── plugin.json
│   └── marketplace.json
│
├── .opencode/                  # OpenCode integration
│   ├── plugin/
│   │   └── workflows.js        # OpenCode plugin
│   ├── INSTALL.md
│   ├── README.md
│   └── COMPATIBILITY.md (this file)
│
├── skills/                     # UNIFIED - Single source of truth
│   ├── dev-implement/SKILL.md
│   ├── dev-debug/SKILL.md
│   ├── dev-tdd/SKILL.md
│   ├── dev-verify/SKILL.md
│   ├── dev-review/SKILL.md
│   ├── ds-implement/SKILL.md
│   ├── writing/SKILL.md
│   └── [34+ other skills]
│
├── commands/                   # Claude Code command definitions
│   ├── dev.md
│   ├── ds.md
│   ├── writing.md
│   └── exit.md
│
├── hooks/                      # Claude Code hooks
│   └── hooks.json
│
├── lib/
│   └── skills-core.js          # Shared skill discovery utilities
│
└── [other directories: common, external, etc]
```

### Single Source of Truth

**All 40 skills live in `/skills/`** and are used by both platforms:
- **Claude Code** references `/skills/` via `.claude-plugin/`
- **OpenCode** references `/skills/` via `.opencode/plugin/workflows.js`

This eliminates duplication and ensures both platforms stay in sync.

### Benefits of Unified Model

- **No duplication:** One SKILL.md file, works on both platforms
- **Single maintenance:** Update once, works everywhere
- **Consistent behavior:** Both platforms use identical skill content
- **Easier evolution:** New platforms can reference same `/skills/` directory
- **Follows superpowers pattern:** Matches obra/superpowers architecture

## Key Differences: OpenCode vs Claude Code

### Tool Ecosystem

| Task | Claude Code | OpenCode | Mapping |
|------|------------|----------|---------|
| Load skill | `Skill(skill="workflows:dev-implement")` | `use_skill(skill_name="dev-implement")` | Direct tool call |
| Spawn subagent | `Task(subagent_type="...", prompt="...")` | `@mention subagent` or native agent system | Use OpenCode's agent invocation |
| Track plan | `TodoWrite(todos=[...])` | `update_plan(...)` or file operations | Use native planning tools |
| File operations | `Read`, `Write`, `Edit` | Native file tools | Same semantics, different names |
| Run commands | `Bash` | Native bash/shell tool | Same semantics |

### Skill Discovery

**Claude Code:**
- Plugins registered via marketplace
- Skills namespaced: `workflows:dev-implement`
- Loaded via `.claude-plugin/plugin.json` descriptor

**OpenCode:**
- Skills discovered from filesystem
- Priority: Project (`.opencode/skill/`) > Personal (`~/.config/opencode/skills/`) > Global
- No manifest needed—introspection finds SKILL.md files

### Frontmatter Format

Both use markdown with YAML frontmatter, but OpenCode is stricter:

**Claude Code:**
```yaml
---
name: dev-implement
description: "REQUIRED Phase 5 of /dev workflow..."
---
```

**OpenCode:**
```yaml
---
name: dev-implement
description: Orchestrate implementation with per-task loops and delegated TDD
---
```

OpenCode requires simpler description (no special phrases like "REQUIRED Phase 5").

### Agent Loops

**Claude Code:**
- Uses ralph-wiggum for specialized loops
- Agents have specific roles (implementer, reviewer, tester)
- Explicit "promise" mechanism for task completion

**OpenCode:**
- Subagents are generic (no built-in roles)
- Completion tracked via skill completion or agent return
- Simpler mental model, less scaffolding

## Skill Coverage

### All 40 Skills - Unified and Available

All skills are now unified in `/skills/` and available to both Claude Code and OpenCode:

**Development (19):** dev, dev-implement, dev-debug, dev-tdd, dev-verify, dev-review, dev-brainstorm, dev-design, dev-explore, dev-clarify, dev-delegate, dev-test, dev-test-chrome, dev-test-linux, dev-test-hammerspoon, dev-test-playwright, dev-ralph-loop, dev-tools, using-workflows

**Data Science (8):** ds, ds-implement, ds-brainstorm, ds-delegate, ds-plan, ds-review, ds-verify, ds-tools

**Writing (4):** writing, writing-brainstorm, writing-econ, writing-legal

**Specialized (9):** ai-anti-patterns, notebook-debug, jupytext, marimo, wrds, lseg-data, gemini-batch, using-skills, exit

Each skill works identically on both platforms.

## How Skills Differ

### Content Adaptation

When converting Claude Code skills to OpenCode format:

1. **Remove platform-specific jargon** - "REQUIRED Phase 5" → "Use after design approval"
2. **Replace tool references** - `Skill(skill="...")` → `use_skill(skill_name="...")`
3. **Simplify agent instructions** - Ralph loops → generic subagent spawning
4. **Keep core methodology** - TDD, debugging, verification remain unchanged
5. **Add tool mapping section** - Explain how to adapt for OpenCode

### Example: dev-tdd Skill

**Claude Code version:**
- 193 lines
- References Claude Code-specific concepts
- Ralph loop integration
- Detailed tool descriptions

**OpenCode version:**
- 180 lines
- Platform-agnostic methodology
- Subagent-friendly instructions
- Simplified tool references

Both encode the same RED-GREEN-REFACTOR process, just adapted for each platform's agent model.

## Development Guidelines

### Adding New OpenCode Skills

1. **Start from Claude Code version:**
   ```bash
   cat plugins/workflows/skills/dev-foo/SKILL.md
   ```

2. **Create OpenCode version:**
   ```bash
   mkdir -p .opencode/skill/dev-foo
   ```

3. **Adapt content:**
   - Keep methodology, simplify tool references
   - Remove platform-specific jargon
   - Test with OpenCode

4. **Update SKILL.md frontmatter:**
   ```yaml
   ---
   name: dev-foo
   description: One-line description (max 100 chars)
   ---
   ```

5. **Update COMPATIBILITY.md** with status

### Backporting Improvements

If an improvement applies to both versions:

1. **Update Claude Code version** in `plugins/workflows/skills/`
2. **Backport to OpenCode version** in `.opencode/skill/`
3. **Document in commit message** - "Apply to both Claude Code and OpenCode versions"

### Testing OpenCode Skills

```bash
# Verify SKILL.md format
ls -la .opencode/skill/*/SKILL.md

# Check frontmatter
head -5 .opencode/skill/dev-*/SKILL.md

# Test in OpenCode
# In OpenCode: use_skill(skill_name="dev-implement")
```

## Branch Management

### When to Merge to Main

This branch should merge to main when:
- Core development skills are fully converted
- Documentation is complete
- At least one user has validated the setup

### Keeping in Sync with Main

```bash
# Fetch latest from main
git fetch origin main

# Check for divergence
git log --oneline main..opencode-compatibility
git log --oneline opencode-compatibility..main

# Merge main into this branch (if needed)
git merge main
```

### Backporting Fixes to Main

If a fix applies to both versions:

```bash
# Create a commit on opencode-compatibility
git add .opencode/skill/dev-foo/SKILL.md
git commit -m "Fix: improve dev-foo skill description

- Apply to both Claude Code and OpenCode versions"

# Cherry-pick to main
git checkout main
git cherry-pick opencode-compatibility
# Then manually apply the same fix to plugins/workflows/skills/dev-foo/
```

## Installation Paths

### Recommended: Global Installation

```bash
# Clone to OpenCode config
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows

# Link skills
mkdir -p ~/.config/opencode/skills
ln -sf ~/.config/opencode/workflows/.opencode/skill/* ~/.config/opencode/skills/
```

**Pros:** Automatic updates via `git pull`, one location
**Cons:** Skills in global config (not project-specific)

### Alternative: Project Installation

```bash
# In your project root
mkdir -p .opencode/skill
cp -r ~/.config/opencode/workflows/.opencode/skill/* .opencode/skill/
```

**Pros:** Project-specific skills, version controlled with your project
**Cons:** Manual updates, duplicate files

### Alternative: Symlink in Project

```bash
# In your project root
mkdir -p .opencode
ln -s ~/.config/opencode/workflows/.opencode/skill .opencode/skill
```

**Pros:** Shared via symlink, automatic updates
**Cons:** Requires git symlink support

## Troubleshooting

### Skills Not Appearing in OpenCode

1. Check path: `ls ~/.config/opencode/skills/dev-*`
2. Verify SKILL.md: `head -5 ~/.config/opencode/skills/dev-implement/SKILL.md`
3. Restart OpenCode
4. Use `use_skill(skill_name="using-workflows")` to verify skills load

### Tool Mapping Errors

Skills mention Claude Code tools. Map to OpenCode equivalents:

- `Skill(skill="...")` → `use_skill(skill_name="...")`
- `Task(...)` → Use OpenCode's `@mention` subagent system
- `TodoWrite` → Use `update_plan` or file operations
- `Bash`, `Read`, `Write`, `Edit` → Use OpenCode's native tools

### Branch Conflicts

If merging with main introduces conflicts:

```bash
git status
# Resolve conflicts in .opencode/ files vs plugins/workflows/ files
# They should never conflict (different directories)
```

## Contributing

Found an issue with OpenCode skills? Please:

1. Report on GitHub: https://github.com/edwinhu/workflows/issues
2. Include: OpenCode version, skill name, error message
3. Mention: "opencode-compatibility branch"

## License

MIT - Same as main branch

## See Also

- **OpenCode Docs:** https://opencode.ai
- **Claude Code Plugin:** Main branch, `/plugin marketplace add edwinhu/workflows`
- **Workflows README:** [README.md](../README.md)

