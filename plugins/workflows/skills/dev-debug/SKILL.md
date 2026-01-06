---
name: dev-debug
description: "Systematic debugging with 4-phase methodology. Uses ralph loop for verification-driven bug fixing."
---

**Announce:** "I'm using dev-debug for systematic bug investigation."

## Where This Fits

```
Main Chat (you)                    Task Agent
─────────────────────────────────────────────────────
dev-debug (this skill)
  → ralph loop (one per bug)
    → dev-delegate (spawn agents)
      → Task agent ──────────────→ investigates
                                   writes regression test
                                   implements fix
```

**Main chat orchestrates.** Task agents investigate and fix.

## Contents

- [The Iron Law of Debugging](#the-iron-law-of-debugging)
- [The Iron Law of Delegation](#the-iron-law-of-delegation)
- [The Process](#the-process)
- [The Four Phases](#the-four-phases)
- [If Max Iterations Reached](#if-max-iterations-reached)

# Systematic Debugging

<EXTREMELY-IMPORTANT>
## The Iron Law of Debugging

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. This is not negotiable.**

Before writing ANY fix, you MUST:
1. Reproduce the bug (with a test)
2. Trace the data flow
3. Form a specific hypothesis
4. Test that hypothesis
5. Only THEN write a fix (with a regression test first!)

**If you catch yourself about to write a fix without investigation, STOP.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Delegation

**MAIN CHAT MUST NOT WRITE CODE. This is not negotiable.**

Main chat orchestrates the ralph loop. Task agents do the work:
- **Investigation**: Task agents read code, run tests, gather evidence
- **Fixes**: Task agents write regression tests and fixes

| Main Chat Does | Task Agents Do |
|----------------|----------------|
| Start ralph loop | Investigate root cause |
| Spawn Task agents | Run tests, read code |
| Review findings | Write regression tests |
| Verify fix | Implement fixes |

**If you're about to edit code directly, STOP and delegate instead.**
</EXTREMELY-IMPORTANT>

## The Process

Unlike implementation (per-task loops), debugging uses **ONE loop per bug**:

```
1. Start ralph loop for the bug
   /ralph-wiggum:ralph-loop "Debug: [SYMPTOM]" --max-iterations 15 --completion-promise "FIXED"

2. Inside loop: spawn Task agent for investigation/fix
   → Skill(skill="workflows:dev-delegate")

3. Task agent follows 4-phase debug protocol

4. When regression test passes → output promise
   <promise>FIXED</promise>

5. Bug fixed, loop ends
```

### Step 1: Start Ralph Loop

**IMPORTANT:** Avoid parentheses `()` in the prompt.

```
/ralph-wiggum:ralph-loop "Debug: [SYMPTOM]" --max-iterations 15 --completion-promise "FIXED"
```

### Step 2: Spawn Task Agent

Use dev-delegate, but with debug-specific instructions:

```
Task(subagent_type="general-purpose", prompt="""
Debug [SYMPTOM] following systematic protocol.

## Context
- Read .claude/LEARNINGS.md for prior hypotheses
- Read .claude/SPEC.md for expected behavior

## Debug Protocol (4 Phases)

### Phase 1: Investigate
- Add debug logging to suspected code path
- Reproduce the bug with a test
- Document: "Reproduced with [test], output: [error]"

### Phase 2: Analyze
- Trace data flow through the code
- Compare to working code paths
- Document findings in LEARNINGS.md

### Phase 3: Hypothesize
- Form ONE specific hypothesis
- Test it with minimal change
- If wrong: document what was ruled out
- If right: proceed to fix

### Phase 4: Fix
- Write regression test FIRST (must fail before fix)
- Implement minimal fix
- Run test, see it PASS
- Run full test suite

## Output
Report:
- Hypothesis tested
- Root cause (if found)
- Regression test written
- Fix applied (or blockers)
""")
```

### Step 3: Verify and Complete

After Task agent returns, verify:
- [ ] Regression test FAILS before fix
- [ ] Regression test PASSES after fix
- [ ] Root cause documented in LEARNINGS.md
- [ ] All existing tests still pass

**If ALL pass → output the promise:**
```
<promise>FIXED</promise>
```

**If ANY fail → iterate (don't output promise yet).**

## The Four Phases

| Phase | Purpose | Output |
|-------|---------|--------|
| **Investigate** | Reproduce, trace data flow | Bug reproduction |
| **Analyze** | Compare working vs broken | Findings documented |
| **Hypothesize** | ONE specific hypothesis | Hypothesis tested |
| **Fix** | Regression test → fix | Tests pass |

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

## If Max Iterations Reached

Ralph exits after max iterations. **Still do NOT ask user to manually verify.**

Main chat should:
1. **Summarize** hypotheses tested (from LEARNINGS.md)
2. **Report** what was ruled out and what remains unclear
3. **Ask user** for direction:
   - A) Start new loop with different investigation angle
   - B) Add more logging to specific code path
   - C) User provides additional context
   - D) User explicitly requests manual verification

**Never default to "please verify manually".** Always exhaust automation first.

## When Fix Requires Substantial Changes

If root cause reveals need for significant refactoring:

1. Document root cause in LEARNINGS.md
2. Complete debug loop with `<promise>FIXED</promise>` for the investigation
3. Use `Skill(skill="workflows:dev")` for the implementation work

Debug finds the problem. The dev workflow implements the solution.
