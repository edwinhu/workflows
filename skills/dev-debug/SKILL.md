---
name: dev-debug
description: Systematic debugging with 4-phase methodology. Uncover root cause before writing fixes.
---

# Systematic Debugging

## Overview

A bug doesn't get fixed—it gets investigated, understood, then fixed.

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. This is not negotiable.**

Before writing ANY fix, you MUST:
1. Reproduce the bug (with a test)
2. Trace the data flow
3. Form a specific hypothesis
4. Test that hypothesis
5. Only THEN write a fix (with a regression test first!)

## The Iron Law of Delegation

**YOU MUST NOT WRITE CODE. This is not negotiable.**

Main chat orchestrates. Subagents investigate and fix.

| Main Chat Does | Subagents Do |
|----------------|----------------|
| Set up loop for the bug | Investigate root cause |
| Spawn subagents | Run tests, read code |
| Review findings | Write regression tests |
| Verify fix | Implement fixes |

## The Process

### Step 1: Create Loop Context

Set up a loop for debugging the bug:
- Describe the symptom clearly
- Document expected vs actual behavior
- Set max iterations (typically 10-15)

### Step 2: Spawn Subagent for Investigation

Use OpenCode's subagent system with debug-specific instructions:

**Instructions:**

```
Investigate and fix: [SYMPTOM]

## Context
- Read .opencode/LEARNINGS.md for prior hypotheses
- Read code carefully before claiming anything

## Debug Protocol (4 Phases)

### Phase 1: Investigate
- Reproduce the bug with a failing test
- Document: "Reproduced with [test], output: [error]"
- Add logging to suspected code paths

### Phase 2: Analyze
- Trace data flow through the code
- Compare to working code paths
- Document findings in LEARNINGS.md

### Phase 3: Hypothesize
- Form ONE specific hypothesis about root cause
- Test it with minimal, targeted change
- If wrong: document what was ruled out
- If right: proceed to Phase 4

### Phase 4: Fix
- Write regression test FIRST (must fail before fix)
- Implement minimal fix
- Run test, verify it PASSES
- Run full test suite, verify no regressions

## Verification Checklist
- [ ] Regression test FAILS before fix
- [ ] Regression test PASSES after fix
- [ ] Root cause documented in LEARNINGS.md
- [ ] All existing tests still pass
```

### Step 3: Verify and Complete

After subagent returns, verify the checklist:
- [ ] Regression test written and passes
- [ ] Root cause documented
- [ ] All existing tests still pass
- [ ] Minimal, targeted change (not shotgun debugging)

**If ALL pass:** Mark bug as fixed and move on.
**If ANY fail:** Ask subagent to investigate further or ask user for guidance.

## The Gate Function

Before claiming ANY bug is fixed:

```
1. REPRODUCE → Run test, see bug manifest
2. INVESTIGATE → Trace data flow, form hypothesis
3. TEST → Verify hypothesis with minimal change
4. FIX → Write regression test FIRST (see it FAIL)
5. VERIFY → Run fix, see regression test PASS
6. CONFIRM → Run full test suite, no regressions
7. CLAIM → Only after steps 1-6
```

**Skipping any step is guessing, not debugging.**

## The Four Phases

| Phase | Purpose | Output |
|-------|---------|--------|
| **Investigate** | Reproduce, trace data flow | Bug reproduction + test |
| **Analyze** | Compare working vs broken | Findings documented |
| **Hypothesize** | ONE specific hypothesis | Hypothesis tested |
| **Fix** | Regression test → fix | Tests pass + root cause |

## Rationalization Prevention

These thoughts mean STOP—you're about to skip the protocol:

| Thought | Reality |
|---------|---------|
| "I know exactly what this is" | Knowing ≠ verified. Investigate anyway. |
| "Let me just try this fix" | Guessing. Form hypothesis first. |
| "The fix is obvious" | Obvious fixes often mask deeper issues. |
| "I've seen this before" | This instance may be different. Verify. |
| "No need for regression test" | Every fix needs a regression test. Period. |
| "It works now" | "Works now" ≠ "fixed correctly". Run full suite. |
| "I'll add the test later" | You won't. Write it BEFORE the fix. |

### Red Flags - STOP If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "Let's just try this fix" | You're guessing | Investigate first |
| "I'm pretty sure it's this" | "Pretty sure" ≠ root cause | Gather evidence |
| "This should work" | Hope is not debugging | Test your hypothesis |
| "Let me change a few things" | Multiple changes = can't learn | ONE hypothesis at a time |

## If a Hypothesis Fails

Don't give up. Instead:

1. Document what was ruled out
2. Form a NEW hypothesis
3. Test the new hypothesis
4. Repeat until root cause is found

Every failed hypothesis teaches you something. That's progress.

## If Max Iterations Reached

You've iterated many times without finding root cause. This is still progress:

Main chat should:
1. **Summarize** hypotheses tested (from LEARNINGS.md)
2. **Report** what was ruled out and what remains unclear
3. **Ask user** for direction:
   - A) Start new loop with different investigation angle
   - B) Add more instrumentation to specific code path
   - C) User provides additional context
   - D) User explicitly requests other actions

**Never default to "please verify manually".** Always exhaust automation first.

## When Fix Requires Substantial Refactoring

If root cause reveals a need for significant refactoring:

1. Document root cause thoroughly in LEARNINGS.md
2. Mark debug loop as complete (investigation done)
3. Use the `dev-implement` skill for the refactoring work

Debugging finds the problem. Implementation solves the problem.

