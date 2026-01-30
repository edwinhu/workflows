---
description: Entry point for all writing tasks - quick edits or full project workflow
allowed-tools: Read, Write, AskUserQuestion
---

# Writing

**Entry point for all writing tasks.** Routes based on intent:
- **Quick mode**: Edit/review text with Strunk & White rules
- **Project mode**: Full workflow with PRECIS, OUTLINE, drafts

## Step 1: Check for Active Workflow

```
if .claude/ACTIVE_WORKFLOW.md exists and workflow == "writing":
    → Resume existing project (Step 2)
else:
    → Detect intent (Step 3)
```

## Step 2: Resume Existing Project

Read workflow state and load appropriate domain skill:

```
Read(".claude/ACTIVE_WORKFLOW.md")
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
```

Based on `style` field:
- `legal` → Load `${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/SKILL.md`
- `econ` → Load `${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-econ/SKILL.md`
- `general` → Load `${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-general/SKILL.md`

Announce current phase and continue.

## Step 3: Detect Intent

Analyze the user's request to determine mode:

**Quick Mode Indicators:**
- "Check this paragraph"
- "Edit this text"
- "Review my writing"
- "Make this clearer"
- "Fix the style"
- Short text provided inline
- No mention of "project", "paper", "article", "draft"

**Project Mode Indicators:**
- "Write a paper on..."
- "Start a law review article"
- "Draft an economics paper"
- "I'm working on an article about..."
- "Help me write about..."
- Mentions thesis, argument, research

## Step 4: Route Based on Intent

### Quick Mode

Load the general writing skill for immediate editing:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-general/SKILL.md")
```

Apply Strunk & White rules to the provided text. No workflow state needed.

### Project Mode

Start the brainstorm workflow to set up the project:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-brainstorm/SKILL.md")
```

This will:
1. Interview for thesis, audience, claims
2. Create `.claude/PRECIS.md`
3. Create `.claude/OUTLINE.md`
4. Create `.claude/ACTIVE_WORKFLOW.md`
5. Load appropriate domain skill based on detected domain

## Workflow Overview

```
/writing (this command - entry point)
    │
    ├── Quick mode → lib/skills/writing-general/
    │
    └── Project mode → lib/skills/writing-brainstorm/
            │
            ├── .claude/PRECIS.md
            ├── .claude/OUTLINE.md
            └── .claude/ACTIVE_WORKFLOW.md
                    │
                    ▼
            lib/skills/writing-outline/ (per section)
                    │
                    ▼
            lib/skills/writing-[domain]/
            (legal | econ | general)
                    │
                    └── Draft/Edit loop
                            │
                            ▼
                    /writing-edit (verify + polish + complete)
```

## Available Commands

- `/writing-edit` - Run edit cycle (verify → polish → complete)

## Domain Detection

During brainstorm, detect domain from topic and sources:

| Domain Indicators | Internal Skill | Style Value |
|-------------------|----------------|-------------|
| Legal cases, statutes, law reviews, constitutional | writing-legal | legal |
| Economics, markets, policy, data, empirical | writing-econ | econ |
| General/other | writing-general | general |
