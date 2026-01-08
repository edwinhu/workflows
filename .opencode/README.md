# Workflows for OpenCode

Complete guide for using the workflows skills library with [OpenCode.ai](https://opencode.ai).

## Quick Install

Tell OpenCode:

```
Fetch and follow instructions from https://raw.githubusercontent.com/edwinhu/workflows/refs/heads/opencode-compatibility/.opencode/INSTALL.md
```

Or run the automated installer:

```bash
# Clone the repo first
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows

# Then run the installer
bash ~/.config/opencode/workflows/.opencode/install.sh
```

## What You Get

All 40 workflows skills immediately available:

- **Development** (19 skills): dev, dev-implement, dev-debug, dev-tdd, dev-verify, dev-review, dev-brainstorm, dev-design, dev-explore, dev-clarify, dev-delegate, dev-test, dev-test-chrome, dev-test-linux, dev-test-hammerspoon, dev-test-playwright, dev-ralph-loop, dev-tools, using-workflows

- **Data Science** (8 skills): ds, ds-implement, ds-brainstorm, ds-delegate, ds-plan, ds-review, ds-verify, ds-tools

- **Writing** (4 skills): writing, writing-brainstorm, writing-econ, writing-legal

- **Specialized** (9 skills): ai-anti-patterns, notebook-debug, jupytext, marimo, wrds, lseg-data, gemini-batch, using-skills, exit

## Features

### Automatic Context Injection

The plugin automatically provides workflows context when you start OpenCode. No manual setup needed.

### Skill Discovery

Use the `find_skills` tool to list all available skills:

```
find_skills
```

### Load a Skill

Use the `use_skill` tool to load a specific skill:

```
use_skill(skill_name="dev-implement")
```

## Architecture

### Unified Skills

All skills live in a single `/skills/` directory. Works on both Claude Code and OpenCode.

```
workflows/
├── skills/              # Unified skills (39 total)
│   ├── dev-implement/SKILL.md
│   ├── dev-debug/SKILL.md
│   └── [37 more]
├── lib/
│   └── skills-core.js   # Shared discovery utilities
└── .opencode/
    ├── plugin/          # OpenCode bridge plugin
    └── INSTALL.md       # This guide
```

### Plugin Location

**Installed at:** `~/.config/opencode/plugin/workflows.js`

**Provides:**
- `use_skill` - Load a skill by name
- `find_skills` - List all available skills
- Automatic context injection via chat.message hook
- Re-injection after context compaction

## Installation Details

### Option 1: Automated Installer (Recommended)

```bash
# Download and run the installer
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows
bash ~/.config/opencode/workflows/.opencode/install.sh
```

**What it does:**
- Clones the workflows repository
- Creates symlinks to all 40 skills in `~/.config/opencode/skill/`
- Installs the plugin to `~/.config/opencode/plugin/`

**Benefits:**
- Interactive prompts for different installation methods
- Automatic verification
- Clean error messages

### Option 2: Manual Installation

```bash
# 1. Clone the repository
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows

# 2. Create directories
mkdir -p ~/.config/opencode/skill
mkdir -p ~/.config/opencode/plugin

# 3. Create skill symlinks (auto-update when repo updates)
ln -sf ~/.config/opencode/workflows/skills/* ~/.config/opencode/skill/

# 4. Install the plugin
cp ~/.config/opencode/workflows/.opencode/plugin/workflows.js ~/.config/opencode/plugin/

# 5. Restart OpenCode
```

### Option 3: Project-Local Installation

For project-specific skills:

```bash
# In your OpenCode project
mkdir -p .opencode/skill
ln -sf ~/.config/opencode/workflows/skills/* .opencode/skill/
```

OpenCode will automatically discover these alongside global skills.

## Verification

### Check Skills Directory

```bash
ls ~/.config/opencode/skill/ | wc -l
# Should show: 39
```

### Check Plugin

```bash
ls -l ~/.config/opencode/plugin/workflows.js
# Should exist and not be a broken link
```

### In OpenCode

```
find_skills
# Should list all 39 workflows skills
```

## Usage

### Finding Skills

Use the `find_skills` tool to discover available skills. It shows skill names and descriptions.

### Loading Skills

Load a skill with the `use_skill` tool:

```
use_skill(skill_name="dev-implement")
```

The full skill content is inserted into your conversation and persists throughout your session.

### Creating Personal Skills

Store reusable skills in `~/.config/opencode/skills/`:

```bash
mkdir -p ~/.config/opencode/skills/my-skill
```

Create `~/.config/opencode/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: My custom skill for common tasks
---

# My Skill

[Your skill content here]
```

### Creating Project Skills

Create project-specific skills in `.opencode/skills/`:

```bash
mkdir -p .opencode/skills/my-project-skill
```

Create `.opencode/skills/my-project-skill/SKILL.md` with the same structure above.

## Skill Priority

Skills are resolved with this priority:

1. **Project skills** (`.opencode/skills/`) - Highest
2. **Personal skills** (`~/.config/opencode/skills/`)
3. **Workflows skills** (`~/.config/opencode/workflows/skills/`)
4. **Other global skills** (`~/.config/opencode/skills/`)

Force resolution to a specific level:

- `project:skill-name` - Load from project
- `skill-name` - Search in priority order (default)
- `workflows:skill-name` - Load from workflows

## Tool Mapping

When skills reference Claude Code tools, map them to OpenCode:

| Claude Code | OpenCode |
|------------|----------|
| `Skill(skill="...")` | `use_skill(skill_name="...")` |
| `Task(subagent_type="...", prompt="...")` | Use `@mention` or native agents |
| `TodoWrite` | `update_plan` or file operations |
| `Read`, `Write`, `Edit` | Native file tools |
| `Bash` | Native bash/shell tool |

The skills themselves are platform-agnostic. The plugin handles platform differences.

## Updating

### With Global Installation

```bash
cd ~/.config/opencode/workflows
git pull origin opencode-compatibility
```

Skills auto-update since they're symlinked.

### With Project Installation

```bash
# Re-run the setup commands
ln -sf ~/.config/opencode/workflows/skills/* .opencode/skill/
```

## Troubleshooting

### Plugin Not Loading

1. Verify plugin exists: `ls ~/.config/opencode/plugin/workflows.js`
2. Check symlink is valid: `ls -l ~/.config/opencode/skill/`
3. Restart OpenCode
4. Check OpenCode logs for errors

### Skills Not Found

1. List skills: `ls ~/.config/opencode/skill/`
2. Verify SKILL.md files: `ls ~/.config/opencode/skill/*/SKILL.md`
3. Use `find_skills` in OpenCode
4. Check `~/.config/opencode/workflows/skills/` exists

### Tool Issues

- `use_skill` not working? → Verify plugin installed
- `find_skills` not working? → Restart OpenCode
- Skills showing old version? → `cd ~/.config/opencode/workflows && git pull`

### Context Not Injecting

If workflows context isn't automatically injected:

1. Verify plugin loaded: Check OpenCode logs
2. Confirm plugin path: `ls ~/.config/opencode/plugin/workflows.js`
3. Restart OpenCode completely

## Architecture Comparison

### Before (Duplication)

```
workflows/
├── plugins/workflows/skills/      # Claude Code (38 skills)
└── .opencode/skill/               # OpenCode (33 copied skills)
                                   # DUPLICATED - hard to maintain
```

### After (Unified)

```
workflows/
├── skills/                         # Unified source (40 skills)
├── lib/skills-core.js              # Shared utilities
├── .opencode/plugin/               # OpenCode plugin
└── plugins/workflows/              # Claude Code unchanged
```

**Benefits:**
- Single source of truth
- One edit fixes both platforms
- No duplication to maintain
- Consistent experience everywhere

## Skill Status

### ✅ Fully OpenCode-Compatible

All 40 skills in `/skills/` are production-ready for OpenCode.

- Core development workflows
- Data science workflows
- Writing workflows
- Specialized tools

### Claude Code

The main branch continues to work as before:

```bash
git clone https://github.com/edwinhu/workflows
# Use `/plugin install workflows` in Claude Code
```

## Getting Help

- **OpenCode Docs:** https://opencode.ai
- **Workflows Repository:** https://github.com/edwinhu/workflows
- **Installation Guide:** `.opencode/INSTALL.md`
- **Architecture Details:** `.opencode/COMPATIBILITY.md`
- **Report Issues:** https://github.com/edwinhu/workflows/issues

## See Also

- **Superpowers (inspiration):** https://github.com/obra/superpowers
- **OpenCode Agent Skills Docs:** https://opencode.ai/docs/skills/
- **Main Workflows Branch:** https://github.com/edwinhu/workflows

## License

MIT - Same as main repository
