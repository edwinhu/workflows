---
name: dev-implement
description: "REQUIRED Phase 5 of /dev workflow. Orchestrates per-task ralph loops with delegated TDD implementation."
---

**Announce:** "I'm using dev-implement (Phase 5) to orchestrate implementation."

## Where This Fits

```
Main Chat (you)                    Task Agent
─────────────────────────────────────────────────────
dev-implement (this skill)
  → dev-ralph-loop (per-task loops)
    → dev-delegate (spawn agents)
      → Task agent ──────────────→ follows dev-tdd
                                   uses dev-test tools
```

**Main chat orchestrates.** Task agents implement.

## Contents

- [Prerequisites](#prerequisites)
- [The Iron Law of Delegation](#the-iron-law-of-delegation)
- [The Process](#the-process)
- [Sub-Skills Reference](#sub-skills-reference)
- [If Max Iterations Reached](#if-max-iterations-reached)
- [Phase Complete](#phase-complete)

# Implementation (Orchestration)

<EXTREMELY-IMPORTANT>
## Prerequisites

**Do NOT start implementation without these:**

1. `.claude/SPEC.md` exists with final requirements
2. `.claude/PLAN.md` exists with chosen approach
3. **User explicitly approved** in /dev-design phase

If any prerequisite is missing, STOP and complete the earlier phases.

**Check PLAN.md for:** files to modify, implementation order, testing strategy.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**MAIN CHAT MUST NOT WRITE CODE. This is not negotiable.**

Main chat orchestrates. Subagents implement. If you catch yourself about to use Write or Edit on a code file, STOP.

| Allowed in Main Chat | NOT Allowed in Main Chat |
|---------------------|--------------------------|
| Spawn Task agents | Write/Edit code files |
| Review Task agent output | Direct implementation |
| Write to .claude/*.md files | "Quick fixes" |
| Run git commands | Any code editing |
| Start ralph loops | Bypassing delegation |

**If you're about to edit code directly, STOP and spawn a Task agent instead.**

### Rationalization Prevention

These thoughts mean STOP—you're rationalizing:

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
| "This is boilerplate" | Boilerplate = code = delegate. |
| "PLAN.md is detailed, just executing" | Execution IS implementation. Delegate. |

### The Meta-Rationalization

**If you're treating these rules as "guidelines for complex work" rather than "invariants for ALL work", you've already failed.**

Simple work is EXACTLY when discipline matters most—because that's when you're most tempted to skip it.
</EXTREMELY-IMPORTANT>

## The Process

```
For each task N in PLAN.md:
    1. Start ralph loop for task N
       → Skill(skill="workflows:dev-ralph-loop")

    2. Inside loop: spawn Task agent
       → Skill(skill="workflows:dev-delegate")

    3. Task agent follows TDD (dev-tdd) using testing tools (dev-test)

    4. Verify tests pass, output promise

    5. Move to task N+1, start NEW ralph loop
```

### Step 1: Start Ralph Loop for Each Task

**REQUIRED SUB-SKILL:**
```
Skill(skill="workflows:dev-ralph-loop")
```

Key points from dev-ralph-loop:
- ONE loop PER TASK (not one loop for feature)
- Each task gets its own completion promise
- Don't move to task N+1 until task N's loop completes

### Step 2: Inside Loop - Spawn Task Agent

**REQUIRED SUB-SKILL:**
```
Skill(skill="workflows:dev-delegate")
```

Key points from dev-delegate:
- Implementer → Spec reviewer → Quality reviewer
- Task agent follows dev-tdd protocol
- Task agent uses dev-test tools

### Step 3: Verify and Complete

After Task agent returns, verify:
- [ ] Tests EXECUTE code (not grep)
- [ ] Tests PASS (SKIP ≠ PASS)
- [ ] LEARNINGS.md has actual output
- [ ] Build succeeds

**If ALL pass → output the promise.** If ANY fail → iterate.

## Sub-Skills Reference

| Skill | Purpose | Used By |
|-------|---------|---------|
| `dev-ralph-loop` | Per-task loop pattern | Main chat |
| `dev-delegate` | Task agent templates | Main chat |
| `dev-tdd` | TDD protocol (RED-GREEN-REFACTOR) | Task agent |
| `dev-test` | Testing tools (pytest, Playwright, etc.) | Task agent |

## If Max Iterations Reached

Ralph exits after max iterations. **Still do NOT ask user to manually test.**

Main chat should:
1. **Summarize** what's failing (from LEARNINGS.md)
2. **Report** which automated tests fail and why
3. **Ask user** for direction:
   - A) Start new loop with different approach
   - B) Add more logging to debug
   - C) User provides guidance
   - D) User explicitly requests manual testing

**Never default to "please test manually".** Always exhaust automation first.

## Phase Complete

**REQUIRED SUB-SKILL:** After ALL tasks complete with passing tests:
```
Skill(skill="workflows:dev-review")
```

Do NOT proceed until automated tests pass for every task.
