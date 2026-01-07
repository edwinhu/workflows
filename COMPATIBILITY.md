# OpenCode Compatibility Guide

This branch (`opencode-compatibility`) adds full support for [OpenCode](https://opencode.ai), the open source AI coding agent. The original Claude Code workflows remain in `plugins/workflows/` and are unchanged.

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

### Directory Structure

```
workflows/
├── plugins/workflows/          # Claude Code version (unchanged)
│   ├── .claude-plugin/
│   ├── commands/
│   ├── hooks/
│   └── skills/
│       ├── dev-implement/
│       ├── dev-debug/
│       └── [40+ other skills]
│
└── .opencode/                  # OpenCode version (this branch)
    ├── INSTALL.md
    ├── COMPATIBILITY.md (this file)
    └── skill/
        ├── dev-implement/
        ├── dev-debug/
        ├── dev-tdd/
        ├── dev-verify/
        ├── dev-review/
        └── using-workflows/
```

### Parallel Maintenance Strategy

Both versions live in the same repository:
- **Claude Code skills** in `plugins/workflows/skills/` (original, complete)
- **OpenCode skills** in `.opencode/skill/` (adapted, growing)

This allows:
- OpenCode users to get started immediately with key skills
- Claude Code users to remain unaffected
- Shared improvements to be backported between versions
- Independent evolution based on each platform's capabilities

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

### Fully Converted

- ✅ **dev-implement** - Task orchestration with TDD
- ✅ **dev-debug** - Systematic debugging
- ✅ **dev-tdd** - Test-Driven Development protocol
- ✅ **dev-verify** - Verification checklist
- ✅ **dev-review** - Code review guidelines
- ✅ **using-workflows** - Introduction and patterns

### Partially Converted (placeholder)

- 🟡 **dev-brainstorm** - Socratic design refinement
- 🟡 **dev-design** - Design validation
- 🟡 **dev-plan** - Implementation planning
- 🟡 **dev-explore** - Codebase exploration

### Not Yet Converted

- ❌ Data science skills (ds-*)
- ❌ Writing skills (writing-*)
- ❌ Specialized test skills (dev-test-linux, dev-test-macos, etc.)
- ❌ Utility skills (marimo, jupytext, wrds, lseg-data)

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

