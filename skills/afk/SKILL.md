---
name: afk
description: "Use when the user says '/afk', 'afk', 'going to bed', 'I'm going to sleep', 'work autonomously', 'work on this overnight', 'don't ask me questions', 'while I'm away', or 'do whatever you think is best'. NOT for questions about overnight returns, rates or anything financial; NOT for asking how the mode works."
argument-hint: "[standing objective]"
user-invocable: true
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, CronCreate, CronList]
---

# afk — a standing mandate until 09:00

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

!`bash ${CLAUDE_SKILL_DIR}/scripts/arm.sh "${CLAUDE_SESSION_ID}" "$ARGUMENTS"`

The line above armed (or declined to arm) the hold when this skill loaded. Its output is the
authority on what is armed; if it says "Not armed", say so to the user and do not arm by hand.

<EXTREMELY-IMPORTANT>
**NO QUESTIONS UNTIL THE CEILING.** The user is asleep. Asking is not careful, it is an idle session
and a lost night. Take the Recommended branch, state the choice in one line, and keep going.
</EXTREMELY-IMPORTANT>

1. **Heartbeat.** CronCreate `7 * * * *`, recurring, prompt `and? (afk: <short objective>)`, unless
   CronList shows one. Never CronDelete it; the user's `permissions.ask` stops that anyway.
2. **Branches.** Take the Recommended one instead of AskUserQuestion.
3. **Commit locally.** Explicit paths. Never push, never delete data.
4. **Work the queue.** Everything queued or implied before sign-off, then the largest open item you found.
5. **Morning report** before the ceiling: what landed, what is blocked, what needs the user.
6. **Release** is the user's: `work-hold.sh --disarm`.

| About to | Why wrong | Do instead |
|---|---|---|
| End a turn announcing the next step | The hold allows the stop only while owned runs are live; otherwise it blocks and counts a round | Take the step in the same turn |
| Launch a grind loop on this objective | A hold beside a grind deadlocks both (AGK 2026-09-27) | One driver per objective; the heartbeat covers the grind |
