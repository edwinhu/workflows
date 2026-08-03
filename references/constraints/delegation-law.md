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
| Run git commands — BEFORE approval only | Any code editing |
| Run test commands (verification) — BEFORE approval only | Grep/Glob code (investigation) |
| | ANY Bash at all, AFTER approval |
| Read HYPOTHESES.md, LEARNINGS.md | Read project source files |
| | Docker exec into containers |
| | Read application logs |
| | Query databases (sqlite3, etc.) |
| | Curl/wget to test endpoints |
| | Inspect process state / env vars |

**Operational debugging is investigation.** Running `docker exec`, reading logs, querying databases, and curling endpoints are ALL investigation — they require interpreting results and forming hypotheses. Delegate to subagents.

**After the plan is APPROVED, main chat gets NO Bash — including the two rows above.** Main chat is the approver, and `hooks/implementer-identity-gate.ts` denies every Bash call from the approving or reviewing actor once a canonical receipt reads `APPROVED`. Not a filtered subset: `git status`, `rg`, and test runs are all refused. This is not an oversight in the gate and it is not an allowlist with a gap — eight rounds established that "does this command line write?" cannot be decided from the text, so the text is no longer read. Do not add an exception; the exception would be a command-line pattern, which is the thing that does not converge.

What to do instead: **dispatch an agent to run the command and return its raw output.** Dispatched agents are unrestricted, and this is the only move the gate's denial recommends. Verification does not become weaker — the evidence is still fresh command output — it just arrives through a subagent that did not approve the plan, which is the same separation this constraint already demands for implementation.

**The one thing that cannot be delegated:** `scripts/goal-self-send.ts` delivers `/goal` into the *caller's own* session — it matches `CLAUDE_CODE_SESSION_ID` against herdr's agent record exactly, requires that record's pane to be the pane the process is running in, and exits `unsafe_identity` on any disagreement. Dispatching an agent buys nothing: a subagent's Bash inherits the parent's session id and pane, so it delivers into the orchestrator's pane rather than its own, which is the delegation this rule forbids. That the *script* cannot detect this is a measured fact, not an oversight — no environment variable distinguishes top-level Bash from subagent Bash, so the prohibition is doctrine here and would have to be enforced from a hook payload's `agent_id` to be mechanical. If the helper does not report `delivered`, fall back to the already-specified path: print the literal `/goal` line and let the user type it.

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

## Delegation Facts

- The boundary cases ARE code and investigation: porting/adapting existing code, config files (JSON/YAML/TOML), setup work, and "quickly checking one thing" in source. All of them delegate. "One thing" historically becomes 50 file reads; a strong hypothesis is what you had last time you were wrong.
- Main-chat context is expensive and subagent time is cheap — burning orchestrator context on work a subagent does with better isolation is counterproductive on its own terms. The author also cannot objectively review their own code; delegation is what preserves review quality.
- This rule is an invariant for ALL work, not a guideline for complex work — simple work is exactly when discipline matters most.

## Red Flags

- **About to use Write or Edit on a project file** — STOP. That's implementation. Spawn a subagent.
- **"Let me quickly check..."** — STOP. Checking source code is investigation. Subagent.
- **"Just reading the logs to understand..."** — STOP. Log reading is investigation. Subagent.
- **"Docker exec to see what's happening"** — STOP. Container inspection is investigation. Subagent.
- **"Let me curl the endpoint to verify"** — STOP. Endpoint testing is investigation. Subagent.
- **Grepping project source files** — STOP. That's investigation. Spawn a subagent.
