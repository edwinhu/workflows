---
name: dev-implement
version: 1.0
description: “REQUIRED Phase 5 of /dev workflow. Orchestrates per-task ralph loops with delegated TDD implementation.”
---

**Announce:** “I’m using dev-implement (Phase 5) to orchestrate implementation.”

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
- [Implementation Strategy Choice](#implementation-strategy-choice)
- [The Iron Law of Delegation](#the-iron-law-of-delegation)
- [The Process](#the-process) (Sequential)
- [Sub-Skills Reference](#sub-skills-reference)
- [If Max Iterations Reached](#if-max-iterations-reached)
- [Agent Team Implementation (Parallel)](#agent-team-implementation-parallel)
- [Phase Complete](#phase-complete)

# Implementation (Orchestration)

<EXTREMELY-IMPORTANT>
## Prerequisites

**Do NOT start implementation without these:**

1. `.claude/SPEC.md` exists with final requirements
2. `.claude/PLAN.md` exists with chosen approach
3. **User explicitly approved** in /dev-design phase
4. **PLAN.md Testing Strategy section is COMPLETE** (all boxes checked)

If any prerequisite is missing, STOP and complete the earlier phases.

**Check PLAN.md for:** files to modify, implementation order, testing strategy.

### Pre-Flight Testing Check (MANDATORY)

Before starting ANY task, verify PLAN.md Testing Strategy:

```
[ ] Framework specified (not empty, not “TBD”)
[ ] Test Command specified (runnable command)
[ ] First Failing Test described (specific test name)
[ ] Test File Location specified (actual path)
```

**If ANY box is unchecked → STOP. Go back to design phase.**

This is your LAST CHANCE to catch missing test strategy before writing code.
</EXTREMELY-IMPORTANT>

## Implementation Strategy Choice

After prerequisites pass, check PLAN.md for parallelization potential:

**Skip this choice when:**
- PLAN.md has fewer than 4 tasks
- All tasks are dependent (every task is `after N` with no independent groups)
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is not available

**Otherwise, ask the user:**

```python
AskUserQuestion(questions=[{
  "question": "How should we implement the tasks in PLAN.md?",
  "header": "Strategy",
  "options": [
    {"label": "Sequential (Default)", "description": "One ralph loop per task, complete N before N+1. Safest, no merge conflicts."},
    {"label": "Agent team (parallel)", "description": "Spawn teammate per independent task group. Faster for 4+ independent tasks. Requires reconciliation."}
  ],
  "multiSelect": false
}])
```

**If Sequential:** Proceed to [The Process](#the-process) below (current behavior).

**If Agent team:** Skip to [Agent Team Implementation (Parallel)](#agent-team-implementation-parallel).

<EXTREMELY-IMPORTANT>
## The Iron Law of TDD (Final Enforcement)

**YOU CANNOT WRITE IMPLEMENTATION CODE WITHOUT A FAILING TEST FIRST.**

This is not a suggestion. This is the workflow. Every task follows:

```
1. READ the test description from PLAN.md
2. WRITE the test file
3. RUN the test → SEE RED (failure)
4. ONLY THEN write implementation
5. RUN the test → SEE GREEN (pass)
```

### Rationalization Prevention (Implementation Phase)

If you catch yourself thinking these, STOP IMMEDIATELY:

| Thought | Reality | Action |
|---------|---------|--------|
| “No test infra, I’ll just implement” | You should have caught this in explore/clarify | STOP. Go back. Add Task 0. |
| “SPEC.md says manual testing” | SPEC.md is wrong | STOP. Fix SPEC.md. Ask user. |
| “This task is too simple for tests” | Simple tasks benefit MOST from tests | Write the test anyway. |
| “I’ll add tests after this works” | That’s not TDD. That’s lying. | DELETE your code. Write test first. |
| “User is waiting, I’ll be quick” | User wants WORKING code, not fast code | Take time. Write test first. |
| “The subagent skipped tests” | Your job is to catch that | REJECT the work. Redo with tests. |
| “Just this one exception” | No exceptions. Ever. | Write the test. |

**If you wrote code without a failing test first, DELETE IT and start over.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**MAIN CHAT MUST NOT WRITE CODE. This is not negotiable.**

Main chat orchestrates. Subagents implement. If you catch yourself about to use Write or Edit on a code file, STOP.

| Allowed in Main Chat | NOT Allowed in Main Chat |
|---------------------|--------------------------|
| Spawn Task agents | Write/Edit code files |
| Review Task agent output | Direct implementation |
| Write to .claude/*.md files | “Quick fixes” |
| Run git commands | Any code editing |
| Start ralph loops | Bypassing delegation |

**If you’re about to edit code directly, STOP and spawn a Task agent instead.**

### Rationalization Prevention

These thoughts mean STOP—you’re rationalizing:

| Thought | Reality |
|---------|---------|
| “It’s just a small fix” | Small fixes become big mistakes. Delegate. |
| “I’ll be quick” | Quick means sloppy. Delegate. |
| “The subagent will take too long” | Subagent time is cheap. Your context is expensive. |
| “I already know what to do” | Knowing ≠ doing it well. Delegate. |
| “Let me just do this one thing” | One thing leads to another. Delegate. |
| “This is too simple for a subagent” | Simple is exactly when delegation works best. |
| “I’m already here in the code” | Being there ≠ writing there. Delegate. |
| “The user is waiting” | User wants DONE, not fast. They won’t debug your shortcuts. |
| “This is just porting/adapting code” | Porting = writing = code. Delegate. |
| “I already have context loaded” | Fresh context per task is the point. Delegate. |
| “It’s config, not real code” | JSON/YAML/TOML = code. Delegate. |
| “I need to set things up first” | Setup IS implementation. Delegate. |
| “This is boilerplate” | Boilerplate = code = delegate. |
| “PLAN.md is detailed, just executing” | Execution IS implementation. Delegate. |

### The Meta-Rationalization

**If you’re treating these rules as “guidelines for complex work” rather than “invariants for ALL work”, you’ve already failed.**

Simple work is EXACTLY when discipline matters most—because that’s when you’re most tempted to skip it.
</EXTREMELY-IMPORTANT>

## The Process

```
For each task N in PLAN.md:
    1. Determine loop type:
       - Visual task? → Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")
       - Standard task? → Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-ralph-loop/SKILL.md")

    2. Inside loop: spawn Task agent
       → Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-delegate/SKILL.md")

    3. Task agent follows TDD (dev-tdd) using testing tools (dev-test)
       Visual tasks: also render output and vision-check with look-at

    4. Verify tests pass (+ visual check passes for visual tasks), output promise

    5. Move to task N+1, start NEW loop
```

### Visual Task Detection

If a PLAN.md task involves rendered visual output, use **visual-verify** instead of plain ralph-loop. Visual-verify adds render → look-at → fix steps inside each iteration.

**Signals a task is visual:** task mentions "render", "slide", "chart", "figure", "layout", "UI", "screenshot", "visual", "diagram", or produces any file meant to be seen by humans (PNG, PDF, SVG).

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")
```

### Step 1: Start Ralph Loop for Each Task

**REQUIRED SUB-SKILL:**
```
Read(“${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-ralph-loop/SKILL.md”)
```

Key points from dev-ralph-loop:
- ONE loop PER TASK (not one loop for feature)
- Each task gets its own completion promise
- Don’t move to task N+1 until task N’s loop completes

### Step 2: Inside Loop - Spawn Task Agent

**REQUIRED SUB-SKILL:**
```
Read(“${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-delegate/SKILL.md”)
```

Key points from dev-delegate:
- Implementer → Spec reviewer → Quality reviewer
- Task agent follows dev-tdd protocol
- Task agent uses dev-test tools

### Step 3: Verify and Complete (MANDATORY - DO NOT SKIP)

<EXTREMELY-IMPORTANT>
**YOU MUST VERIFY EACH OF THESE. “Task complete” without verification is LYING.**

After Task agent returns, **you must personally verify** (not trust the agent’s report):

#### 3a. Read the Actual Code
```
Read the implementation file(s) the agent claims to have written.
Compare to SPEC.md requirements line by line.
```
- [ ] Code matches spec (not a different approach)
- [ ] No substitutions (e.g., spec says IPC, code uses DOM = FAIL)

#### 3b. Check Test Reality
```
Read the test file(s). Look for .skip(), mock-only tests, or tests that don’t call real code.
```
- [ ] Tests EXECUTE code (not grep/mock-only)
- [ ] Tests are NOT skipped (SKIP ≠ PASS)
- [ ] Integration tests exist and run (not just unit tests)

#### 3c. Run Tests Yourself
```
Actually run the test command. Read the output.
```
- [ ] Test command runs without error
- [ ] Tests actually pass (not “66 pass, 0 fail” with 50 skipped)
- [ ] Test output shows real assertions (not just “test exists”)

#### 3d. Verify Real Integration (FOR EXTERNAL SYSTEMS)
```
If the feature integrates with an external system (Electron app, API, database),
you MUST verify it works against the real system, not just mocks.
```
- [ ] External system is actually running
- [ ] Feature actually works (not just “code runs without error”)
- [ ] Output is visible in the external system

**If ANY check fails → REJECT the work. Do NOT mark task complete.**

### Rationalization Prevention (Verification Phase)

| Thought | Reality | Action |
|---------|---------|--------|
| “The agent said tests pass” | Agents lie. Verify yourself. | Run the tests. |
| “66 tests passing is enough” | Count skipped tests. Read test code. | Check for fake tests. |
| “I’ll verify at the end” | You’ll forget. Bugs compound. | Verify NOW. |
| “The spec said X, code does Y, but Y is close enough” | Close enough = wrong. | Reject and redo. |
| “Integration test is skipped but unit tests pass” | Unit tests don’t prove integration works. | Require real integration test. |
| “External system isn’t running, but code is correct” | Untested code is broken code. | Start the system and test. |

**If ALL pass → output the promise.** If ANY fail → iterate.

## Spec Deviation Detection (CRITICAL)

<EXTREMELY-IMPORTANT>
**The most common failure mode: Subagent implements DIFFERENT approach than spec.**

Examples of spec deviations:
- Spec says “IPC channels” → Code uses DOM selectors
- Spec says “WebSocket” → Code uses HTTP polling
- Spec says “use library X” → Code uses library Y
- Spec says “reuse existing function” → Code duplicates logic

### How to Catch Deviations

After EVERY implementation, ask yourself:

```
1. What APPROACH did SPEC.md specify?
   (Read SPEC.md, find the specific approach)

2. What APPROACH did the code actually use?
   (Read the actual implementation code)

3. Are they THE SAME?
   (Not “similar” or “equivalent” - THE SAME)
```

If they differ → REJECT. The spec was approved by the user. Changing the approach without approval is a spec violation.

### Why Subagents Deviate

| Subagent Thinks | Reality |
|-----------------|---------|
| “This approach is easier” | Easier ≠ correct. Follow the spec. |
| “This is equivalent” | User chose the spec approach for a reason. |
| “I couldn’t figure out the spec approach” | Ask questions. Don’t substitute. |
| “The spec approach doesn’t work” | Report failure. Don’t silently change. |

### The Deviation Test

Before marking any task complete, verify:

```
SPEC.md says: [exact quote of approach]
Code does: [actual approach used]
Match: YES / NO

If NO → REJECT and redo with correct approach
```
</EXTREMELY-IMPORTANT>

## Why Skipping Hurts the Thing You Care About Most

| Your Drive | Why You Skip | What Actually Happens | The Drive You Failed |
|------------|-------------|----------------------|---------------------|
| **Helpfulness** | "Skipping TDD gets code to user faster" | Untested code creates bugs the user discovers later | **Anti-helpful** |
| **Efficiency** | "Skipping spec check saves time" | Spec drift means rework — your speed was waste | **Inefficient** |
| **Competence** | "I assumed it works, no need to run tests" | The user runs it and it fails — your assumption destroyed trust | **Incompetent** |
| **Thoroughness** | "I'll delegate without full context" | Subagent builds wrong thing, you redo everything | **Careless** |

**The protocol is not overhead you pay. It is the service you provide.**

## Sub-Skills Reference

| Skill | Purpose | Used By |
|-------|---------|---------|
| `dev-ralph-loop` | Per-task loop pattern | Main chat |
| `dev-delegate` | Task agent templates | Main chat |
| `dev-tdd` | TDD protocol (RED-GREEN-REFACTOR) | Task agent |
| `dev-test` | Testing tools (pytest, Playwright, etc.) | Task agent |

## Failure Recovery Protocol

**Pattern from oh-my-opencode: After 3 consecutive implementation failures, escalate.**

### 3-Failure Trigger

If you attempt 3 implementations and ALL fail tests:

```
Iteration 1: Implement approach A → tests fail
Iteration 2: Implement approach B → tests fail
Iteration 3: Implement approach C → tests fail
→ TRIGGER RECOVERY PROTOCOL
```

### Recovery Steps

1. **STOP** all further implementation attempts
   - No more “let me try a different approach”
   - No guessing or throwing code at the problem

2. **REVERT** to last known working state
   - `git checkout <last-passing-commit>`
   - Or revert specific files
   - Document what was attempted in `.claude/RECOVERY.md`

3. **DOCUMENT** what was attempted
   - All 3 approaches tried
   - Test failures for each
   - Why each approach failed
   - What this reveals about the problem

4. **CONSULT** with user BEFORE continuing
   - “I’ve tried 3 approaches. All fail tests. Here’s what I’ve learned...”
   - Present test failure patterns
   - Request: requirements clarification, design input, or different strategy

5. **ASK USER** for direction
   - Option A: Re-examine requirements (may need /dev-clarify)
   - Option B: Try completely different design (may need /dev-design)
   - Option C: Investigate why tests fail (may need /dev-debug)
   - Option D: User provides domain knowledge

**NO PASSING TESTS = NOT COMPLETE** (hard rule)

### Recovery Checklist

Before continuing after multiple failures:

- [ ] All 3 approaches documented with test failures
- [ ] Pattern in failures identified (same tests? different errors?)
- [ ] Current code reverted to clean state
- [ ] User consulted with specific question
- [ ] Clear direction from user before proceeding

### Anti-Patterns After Failures

**DON’T:**
- Keep trying “just one more thing”
- Make larger and larger changes
- Skip TDD “to get it working first”
- Suppress test failures (“I’ll fix them later”)
- Blame the tests (“tests are wrong”)

**DO:**
- Stop and analyze the failure pattern
- Revert to clean state
- Document what each approach revealed
- Consult user with specific findings
- Get clear direction before continuing

### Example Recovery Flow

```
Loop 1: Implement with synchronous approach → Tests timeout
Loop 2: Implement with async/await → Tests hang
Loop 3: Implement with promises → Tests fail assertion

→ RECOVERY PROTOCOL:
1. STOP (no loop 4)
2. REVERT: git checkout HEAD -- src/feature.ts tests/
3. DOCUMENT in .claude/RECOVERY.md:
   - Pattern: All async implementations cause timing issues
   - Tests expect synchronous behavior
   - Hypothesis: Requirements may need async, tests don’t handle it
4. ASK USER:
   “I’ve tried 3 async implementations. All cause timing issues.
    Tests expect synchronous behavior.

    This suggests either:
    A) Feature should actually be synchronous (simpler)
    B) Tests need updating for async behavior

    Which direction should I take?”
```

### When to Trigger Recovery

Trigger after 3 failures when:
- Same test keeps failing despite different approaches
- Different tests fail in pattern (suggests wrong approach)
- Tests pass locally but fail in CI
- Implementation works but breaks unrelated tests

Don’t wait for max iterations - trigger early when pattern emerges.

## If Max Iterations Reached

Ralph exits after max iterations. **Still do NOT ask user to manually test.**

Main chat should:
1. **Summarize** what’s failing (from LEARNINGS.md)
2. **Report** which automated tests fail and why
3. **Ask user** for direction:
   - A) Start new loop with different approach
   - B) Add more logging to debug
   - C) User provides guidance
   - D) User explicitly requests manual testing

**Never default to “please test manually”.** Always exhaust automation first.

## No Pause Between Tasks

<EXTREMELY-IMPORTANT>
**After completing task N, IMMEDIATELY start task N+1 in the SAME RESPONSE. Do NOT pause.**

### Post-Promise Checklist (mandatory, same response)

1. **Update PLAN.md** - Mark task `[x]` complete
2. **Log to LEARNINGS.md** - What was done
3. **Start next task’s ralph loop** - No waiting

| Thought | Reality |
|---------|---------|
| “Task done, let me check in with user” | NO. User wants ALL tasks done. Keep going. |
| “User might want to review” | User will review at the END. Continue. |
| “Natural pause point” | Only pause when ALL tasks complete or blocked. |
| “Let me summarize progress” | Summarize AFTER all tasks. Keep moving. |
| “User has been waiting” | User is waiting for COMPLETION, not updates. |
| “Should I continue?” | YES. Never ask. Just continue. |
| “I’ll update PLAN.md later” | NO. Update it NOW before next task. |

### Valid Stopping Points (only these three)

1. ALL tasks in PLAN.md are marked `[x]` complete
2. You hit a blocker requiring user input (state exactly what you need)
3. User explicitly interrupted

The promise signals task completion. After outputting promise, update PLAN.md, then IMMEDIATELY start next task’s loop.

**Pausing between tasks is procrastination disguised as courtesy.**

### Task Transition Gate (MANDATORY)

After each task’s ralph loop completes:

1. Update PLAN.md — mark completed task `[x]`
2. Append to LEARNINGS.md — what was accomplished, test command, exit code
3. Check for blockers — dependencies from task N needed for N+1?
4. If clear → IMMEDIATELY spawn ralph loop for task N+1
5. If blocked → Ask user EXACTLY what’s missing (not "I’m blocked")

**Violations to catch:**
- "Let me check with user if they want me to continue" → NO, continue automatically
- "Should I move to task N+1?" → NO, you’re supposed to move
- "Let me summarize what we learned" → NO, move to task N+1

Pausing > 30 seconds between tasks means you’ve stopped. You shouldn’t have.
</EXTREMELY-IMPORTANT>

## Agent Team Implementation (Parallel)

For parallel implementation using agent teams, read the full protocol:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-implement/references/agent-team-protocol.md")
```

**When to use:** User explicitly requests parallel implementation, OR 4+ independent tasks in PLAN.md.

**Key rules:**
- Each teammate gets a self-contained prompt with full context
- Main agent coordinates, does NOT implement directly
- Reconcile results after all teammates complete
- Fall back to sequential if fewer than 3 tasks

## Phase Complete

**REQUIRED SUB-SKILL:** After ALL tasks complete with passing tests:
```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/dev-review/SKILL.md")
```

Do NOT proceed until automated tests pass for every task.
