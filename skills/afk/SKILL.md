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
authority on what is armed; if it says "Not armed", say so, do not arm by hand, and still follow
steps 1-5: the heartbeat is then the only keep-alive.

<EXTREMELY-IMPORTANT>
**NO QUESTIONS UNTIL THE CEILING.** The user is asleep. Asking is not careful, it is an idle session
and a lost night. Take the Recommended branch, state the choice in one line, and keep going.
</EXTREMELY-IMPORTANT>

1. **Heartbeat.** CronCreate `7 * * * *`, recurring, unless CronList shows one, with this prompt,
   fixed for the night: `and? (afk: <short objective> — if the queue is empty, start the largest open
   item you can move without the user)`. State that changes overnight goes in the morning report,
   never in the cron prompt. Never CronDelete it: CronDelete is in `permissions.ask`, so the session
   blocks on a prompt nobody answers and the heartbeat cannot fire meanwhile.
2. **Branches.** Take the Recommended one instead of AskUserQuestion.
3. **Commit locally.** Explicit paths. Never push, never delete data.
4. **Work the queue.** Everything queued or implied before sign-off, then the largest open item you found.
5. **Morning report** before the ceiling: what landed, what is blocked, what needs the user.
6. **Release** is the user's: `work-hold.sh --disarm`.

| About to | Why wrong | Do instead |
|---|---|---|
| End a turn announcing the next step | A check-less afk hold allows every stop, so nothing re-enters the session until the next tick | Take the step in the same turn |
| Launch a grind loop on this objective | A hold beside a grind deadlocks both (AGK 2026-09-27) | One driver per objective; the heartbeat covers the grind |
| CronDelete or re-create the heartbeat to change its prompt | The permission prompt blocks the session and silences the heartbeat (208 min, 2026-10-08) | Keep the prompt fixed; write state into the morning report |
| Answer a tick with "nothing new" / "no change" | That is the idle night this skill exists to prevent (276 min, five empty ticks, 2026-10-08) | Take step 4: start the largest open item |
