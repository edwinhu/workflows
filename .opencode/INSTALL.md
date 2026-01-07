# Installing Workflows for OpenCode

The workflows library provides 39 skills for software development, data science, and writing workflows. This guide shows how to install and set up workflows for OpenCode.

## Quick Start (Automated)

Run this command in your terminal:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/edwinhu/workflows/refs/heads/opencode-compatibility/.opencode/install.sh)
```

This automated installer will:
1. Clone the workflows repository
2. Set up skill symlinks
3. Install the OpenCode plugin
4. Verify installation

Then restart OpenCode and skills are ready to use.

---

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- Git installed
- Terminal/shell access

## Manual Installation

### Global Installation (Recommended)

This approach installs workflows globally so skills are available to all your projects.

**Step 1:** Clone the workflows repository

```bash
git clone -b opencode-compatibility https://github.com/edwinhu/workflows.git ~/.config/opencode/workflows
```

**Step 2:** Create symlinks to all skills

```bash
mkdir -p ~/.config/opencode/skill
ln -sf ~/.config/opencode/workflows/skills/* ~/.config/opencode/skill/
```

This creates symlinks so skills auto-update when you pull the workflows repository.

**Step 3:** Install the OpenCode plugin

```bash
mkdir -p ~/.config/opencode/plugin
cp ~/.config/opencode/workflows/.opencode/plugin/workflows.js ~/.config/opencode/plugin/
```

**Step 4:** Restart OpenCode

Close and reopen OpenCode to load the plugin.

**Step 5:** Verify installation

In OpenCode, run:
```
find_skills
```

You should see all 39 workflows skills listed.

### Project-Local Installation

For project-specific skills without a global installation:

**Step 1:** In your OpenCode project directory, create skills folder

```bash
mkdir -p .opencode/skill
```

**Step 2:** Copy or symlink skills from workflows

```bash
# Option A: Symlink (auto-updates)
ln -sf ~/.config/opencode/workflows/skills/* .opencode/skill/

# Option B: Copy (static copy)
cp -r ~/.config/opencode/workflows/skills/* .opencode/skill/
```

**Step 3:** OpenCode auto-discovers skills

Skills in `.opencode/skill/` are automatically discovered and available in your project.

### Creating Personal Skills

You can also create personal skills available to all projects:

```bash
mkdir -p ~/.config/opencode/skills/my-skill
```

Create `~/.config/opencode/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: What this skill does
---

# My Skill

[Skill content here]
```

Personal skills override workflows skills with the same name.

## Verification

### Check Skills Directory

```bash
ls ~/.config/opencode/skill/ | wc -l
# Should output: 39
```

### Check Plugin Installation

```bash
ls ~/.config/opencode/plugin/workflows.js
# Should show the plugin file (no "No such file" error)
```

### Verify in OpenCode

In OpenCode, use the `find_skills` tool:

```
find_skills
```

This should list all 39 workflows skills with descriptions. If it doesn't work, the plugin may not have loaded. Try restarting OpenCode.

## Using Skills

### Load a Skill

Use the `use_skill` tool:

```
use_skill(skill_name="dev-implement")
```

This loads the full skill content into your conversation. The skill persists throughout your session.

### List Available Skills

```
find_skills
```

Shows all available skills with their descriptions.

### Search for Skills

Skills are named descriptively. Examples:

- **Development:** `dev`, `dev-implement`, `dev-debug`, `dev-tdd`, `dev-verify`, `dev-review`, `dev-brainstorm`, `dev-design`
- **Data Science:** `ds`, `ds-implement`, `ds-brainstorm`, `ds-delegate`, `ds-verify`
- **Writing:** `writing`, `writing-brainstorm`, `writing-econ`, `writing-legal`
- **Specialized:** `ai-anti-patterns`, `notebook-debug`, `jupytext`, `marimo`, and others

Use `find_skills` to see the complete list with descriptions.

## Skill Priority

When multiple versions of a skill exist, OpenCode uses this priority:

1. **Project skills** (`.opencode/skill/`) - Highest priority
2. **Personal skills** (`~/.config/opencode/skills/`)
3. **Workflows skills** (`~/.config/opencode/workflows/skills/`)

Force resolution:
- `project:dev-implement` - Load from project
- `dev-implement` - Search in priority order
- `workflows:dev-implement` - Load from workflows

## Updating Skills

If you used symlinks (recommended), skills auto-update:

```bash
cd ~/.config/opencode/workflows
git pull origin opencode-compatibility
```

If you copied skills, re-run the copy command:

```bash
cp -r ~/.config/opencode/workflows/skills/* .opencode/skill/
```

## Troubleshooting

### Plugin not loading

**Check 1:** Verify plugin file exists
```bash
ls ~/.config/opencode/plugin/workflows.js
```

**Check 2:** Verify skills are installed
```bash
ls ~/.config/opencode/skill/ | head
# Should show skill directories like: dev-implement, dev-debug, etc.
```

**Check 3:** Restart OpenCode completely and try again

### Skills not appearing

**Check 1:** Run `find_skills` in OpenCode - does it work?

**Check 2:** Check skills directory exists and has content
```bash
ls ~/.config/opencode/skill/*/SKILL.md | wc -l
# Should show: 39
```

**Check 3:** Verify SKILL.md files have proper format
```bash
head -5 ~/.config/opencode/skill/dev-implement/SKILL.md
# Should show YAML frontmatter with name and description
```

### Tools referenced in skills don't work

Skills written for Claude Code reference different tools. Use OpenCode equivalents:

- `Skill()` → Use `use_skill()` tool
- `Task()` → Use OpenCode's `@mention` syntax for subagents
- `TodoWrite` → Use `update_plan` or file operations
- File operations → Use OpenCode's native Read/Write/Edit tools

