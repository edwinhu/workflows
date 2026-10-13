---
name: prose-rules-review
description: "The writing-reviewer agent's rule skills (writing-general, writing-legal, writing-econ, ai-anti-patterns) loaded through one skill on either launch path. Named by that agent's skills: and initialPrompt:; the registers themselves are agent-internal."
---

# prose-rules-review — the writing-reviewer agent's rules on the main thread

Each register below is the skill file itself, printed at load time. When this skill is invoked with
arguments, they are your task: do it under these rules.

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" writing-general; echo "(skill loader unavailable: NO writing-general rule was loaded — it is NOT in your context; Read ~/.claude/skills/workflows/skills/writing-general/SKILL.md before grading a sentence)"`

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" writing-legal; echo "(skill loader unavailable: NO writing-legal rule was loaded — it is NOT in your context; Read ~/.claude/skills/workflows/skills/writing-legal/SKILL.md before grading a sentence)"`

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" writing-econ; echo "(skill loader unavailable: NO writing-econ rule was loaded — it is NOT in your context; Read ~/.claude/skills/workflows/skills/writing-econ/SKILL.md before grading a sentence)"`

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" ai-anti-patterns; echo "(skill loader unavailable: NO ai-anti-patterns rule was loaded — it is NOT in your context; Read ~/.claude/skills/workflows/skills/ai-anti-patterns/SKILL.md before grading a sentence)"`
