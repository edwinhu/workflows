---
description: Entry point for all writing tasks - quick edits or full project workflow
allowed-tools: Read
---

Start the writing workflow by reading the brainstorm phase:

Read(“${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-brainstorm/SKILL.md”)

The brainstorm phase will:
1. Detect quick mode vs project mode
2. Gather sources and detect domain (legal/econ/general)
3. Hand off to writing-setup → writing-outline → writing-draft → writing-review → writing-edit
