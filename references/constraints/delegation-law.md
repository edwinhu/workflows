---
name: delegation-law
description: Main chat MUST NOT write code or investigate directly — delegate all implementation and investigation to subagents
applies-to: [dev, dev-tdd, dev-implement, dev-review, dev-verify, dev-debug, dev-delegate, dev-design, dev-explore, dev-handoff, dev-test, dev-test-gaps, dev-spec-reviewer, dev-plan-reviewer]
---

## Rule

**MAIN CHAT MUST NOT WRITE CODE OR INVESTIGATE DIRECTLY. This is not negotiable.**

Main chat orchestrates. Subagents implement and investigate. If you catch yourself about to use Write, Edit, Grep, or Glob on project files (not .planning/ files), STOP and spawn a subagent instead.

| Allowed in Main Chat | NOT Allowed in Main Chat |
|---------------------|--------------------------|
| Spawn Task/Agent subagents | Write/Edit code files |
| Review subagent output | Direct implementation |
| Write to .planning/*.md files | "Quick fixes" |
| Run git commands | Any code editing |
| Run test commands (verification) | Grep/Glob code (investigation) |
| Read HYPOTHESES.md, LEARNINGS.md | Read project source files |
| | Docker exec into containers |
| | Read application logs |
| | Query databases (sqlite3, etc.) |
| | Curl/wget to test endpoints |
| | Inspect process state / env vars |

**Operational debugging is investigation.** Running `docker exec`, reading logs, querying databases, and curling endpoints are ALL investigation — they require interpreting results and forming hypotheses. Delegate to subagents.

## Rationale

**Why this exists** — main chat has expensive context. Every file it reads, every line it writes, is context spent on work that a subagent can do more cheaply and with better isolation. When main chat writes code, it also loses the ability to objectively review that code. The author cannot review their own work — delegation is not just efficiency, it's quality.

## Examples

### Correct

```
User: Fix the auth bug
Main chat: Spawns dev-debug subagent with hypothesis
Subagent: Reads logs, identifies root cause, fixes code, runs tests
Main chat: Reads test results (PASS), records in LEARNINGS.md
```

### Incorrect

```
User: Fix the auth bug
Main chat: "Let me quickly check the auth module..." (Grep/Read on source file)
Main chat: "Ah, I see the issue. Let me fix it." (Edit on source file)
(Investigation AND implementation in main chat — both violations)
```

## Rationalization Table

| Thought | Reality |
|---------|---------|
| "It's just a small fix" | Small fixes become big mistakes. Delegate. |
| "I'll be quick" | Quick means sloppy. Delegate. |
| "The subagent will take too long" | Subagent time is cheap. Your context is expensive. |
| "I already know what to do" | Knowing ≠ doing it well. Delegate. |
| "Let me just do this one thing" | One thing leads to another. Delegate. |
| "This is too simple for a subagent" | Simple is exactly when delegation works best. |
| "I'm already here in the code" | Being there ≠ writing there. Delegate. |
| "The user is waiting" | User wants DONE, not fast. They won't debug your shortcuts. |
| "This is just porting/adapting code" | Porting = writing = code. Delegate. |
| "I already have context loaded" | Fresh context per task is the point. Delegate. |
| "It's config, not real code" | JSON/YAML/TOML = code. Delegate. |
| "I need to set things up first" | Setup IS implementation. Delegate. |
| "Let me just quickly check one thing" | "One thing" becomes 50 file reads. Subagent. |
| "I have a strong hypothesis already" | That's what you thought last time. Subagent. |

**The Meta-Rationalization:** If you're treating these rules as "guidelines for complex work" rather than "invariants for ALL work", you've already failed. Simple work is EXACTLY when discipline matters most.

## Red Flags

- **About to use Write or Edit on a project file** — STOP. That's implementation. Spawn a subagent.
- **"Let me quickly check..."** — STOP. Checking source code is investigation. Subagent.
- **"Just reading the logs to understand..."** — STOP. Log reading is investigation. Subagent.
- **"Docker exec to see what's happening"** — STOP. Container inspection is investigation. Subagent.
- **"Let me curl the endpoint to verify"** — STOP. Endpoint testing is investigation. Subagent.
- **Grepping project source files** — STOP. That's investigation. Spawn a subagent.
