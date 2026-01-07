---
name: dev-implement
description: Orchestrate implementation with per-task loops and delegated TDD. Use after design approval and plan creation.
---

# Implementation (Orchestration)

## Overview

You've approved a design and have a detailed plan. Now orchestrate the implementation by delegating each task to a subagent following TDD.

**Main chat orchestrates. Subagents implement.**

## Prerequisites

Before starting, verify these exist:

1. `.opencode/SPEC.md` or `.claude/SPEC.md` with final requirements
2. `.opencode/PLAN.md` or `.claude/PLAN.md` with chosen approach and task breakdown
3. User has explicitly approved the design

If any prerequisite is missing, stop and complete the earlier phases first.

## The Iron Law of Delegation

**YOU MUST NOT WRITE CODE. This is not negotiable.**

Main chat orchestrates. Subagents implement. If you catch yourself about to use Write or Edit on a code file, STOP.

| Allowed in Main Chat | NOT Allowed in Main Chat |
|---------------------|--------------------------|
| Spawn subagents | Write/Edit code files |
| Review subagent output | Direct implementation |
| Write to .opencode/*.md files | "Quick fixes" |
| Run git commands | Any code editing |
| Coordinate tasks | Bypassing delegation |

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

**If you're treating these rules as "guidelines for complex work" rather than "invariants for ALL work", you've failed.**

Simple work is EXACTLY when discipline matters most—because that's when you're most tempted to skip it.

## The Process

For each task N in PLAN.md:

```
1. Create a loop context for task N
2. Spawn subagent with task-specific instructions
3. Subagent follows TDD protocol (dev-tdd skill)
4. Verify tests pass, document completion
5. Move to task N+1, repeat
```

### Step 1: Set Up Loop Context

Use update_plan or equivalent to track:
- Current task (N of M)
- What's being implemented
- Testing strategy from PLAN.md

### Step 2: Spawn Subagent for Implementation

Use OpenCode's subagent system to spawn a fresh subagent with:

**Instructions:**

```
Implement task: [TASK_NAME] from PLAN.md

## Context
- Read .opencode/SPEC.md for requirements
- Read .opencode/PLAN.md for this task's details
- Check .opencode/LEARNINGS.md for prior iterations

## Protocol
1. Follow test-driven development (TDD)
2. Write failing test FIRST
3. Implement minimal code to pass
4. Run full test suite
5. Report success or blockers

## Verification Checklist
- [ ] Tests EXECUTE code (not grep)
- [ ] Tests PASS (SKIP ≠ PASS)
- [ ] No new regressions
- [ ] Code follows project patterns
```

### Step 3: Verify and Complete

After subagent returns, verify:
- [ ] Tests written before code
- [ ] All tests PASS (SKIP doesn't count)
- [ ] LEARNINGS.md has actual output
- [ ] Build succeeds
- [ ] No regressions in full test suite

**If ALL pass:** Document task as complete and move to task N+1.
**If ANY fail:** Ask subagent to iterate or diagnose blocker.

### Step 4: No Pause Between Tasks

**After completing task N, IMMEDIATELY start task N+1. Do NOT pause.**

| Thought | Reality |
|---------|---------|
| "Task done, let me check in with user" | NO. User wants ALL tasks done. Keep going. |
| "User might want to review" | User will review at the END. Continue. |
| "Natural pause point" | Only pause when ALL tasks complete or blocked. |
| "Let me summarize progress" | Summarize AFTER all tasks. Keep moving. |
| "User has been waiting" | User is waiting for COMPLETION, not updates. |

**Pausing between tasks is procrastination disguised as courtesy.**

## Sub-Skills Reference

| Skill | Purpose | Used By |
|-------|---------|---------|
| `dev-tdd` | TDD protocol (RED-GREEN-REFACTOR) | Subagents |
| `dev-verify` | Verification checklist | Main chat |
| `dev-review` | Code review (use after ALL tasks) | Main chat |

## If a Task Gets Blocked

Don't manually try to fix it. Instead:

1. **Summarize** what's failing (from LEARNINGS.md)
2. **Report** which automated tests fail and why
3. **Ask user** for direction:
   - A) Start new attempt with different approach
   - B) Add more logging to debug
   - C) User provides guidance
   - D) Skip this task (user decision only)

**Never default to manual work.** Always exhaust automation first.

## All Tasks Complete

After ALL tasks pass their tests:

1. Use the `dev-review` skill for final code review
2. Verify no regressions across full test suite
3. Document final status
4. User can decide: merge, iterate, or adjust

