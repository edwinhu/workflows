---
description: Start a render-vision-fix loop for visual output (slides, charts, documents)
argument-hint: [file] [description of what it should look like]
allowed-tools: Read, Bash, Task, Skill, Glob
---

Start the visual verification loop by reading the skill:

Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/visual-verify/SKILL.md")

Use the user's arguments to:
1. Identify the file to render (or auto-detect .typ / .py files)
2. Use the description as the spec for context-enriched vision checks
3. Start a ralph loop with visual-verify protocol
