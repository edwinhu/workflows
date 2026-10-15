---
name: prose-rules-econ
description: "The writing-econ agent's rule skills (writing-general, writing-econ, ai-anti-patterns) loaded through one skill on either launch path. Named by that agent's skills: and initialPrompt:; the registers themselves are agent-internal."
---

# prose-rules-econ — the writing-econ agent's rules on the main thread

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Each register below is the skill file itself, printed at load time. When this skill is invoked with
arguments, they are your task: do it under these rules.

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" writing-general; echo "(skill loader unavailable: NO writing-general rule was loaded — it is NOT in your context; invoke the writing-general skill before writing a sentence)"`

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" writing-econ; echo "(skill loader unavailable: NO writing-econ rule was loaded — it is NOT in your context; invoke the writing-econ skill before writing a sentence)"`

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-skills.ts; [ -f "$c" ] && command -v bun >/dev/null 2>&1 && exec bun "$c" ai-anti-patterns; echo "(skill loader unavailable: NO ai-anti-patterns rule was loaded — it is NOT in your context; invoke the ai-anti-patterns skill before writing a sentence)"`
