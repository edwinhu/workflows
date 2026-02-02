---
description: Entry point for all writing tasks - quick edits or full project workflow
allowed-tools: Read
---

Start the writing workflow by reading the brainstorm phase:

Read(“${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-brainstorm/SKILL.md”)

The brainstorm phase will:
1. Detect quick mode vs project mode
2. Detect domain (legal/econ/general)
3. Load the appropriate domain skill with all enforcement rules
