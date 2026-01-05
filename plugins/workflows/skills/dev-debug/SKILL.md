---
name: dev-debug
description: This skill should be used when the user asks to "debug this", "fix this bug", "investigate this error", "find the root cause", or reports a bug that needs systematic investigation. Uses 4-phase methodology for root cause analysis.
---

## Contents

- [Start Ralph Loop in Main Chat](#start-ralph-loop-in-main-chat)
- [Reference: Debug Protocol](#reference-debug-protocol-for-the-task-agent)
- [The Iron Law of Debugging](#the-iron-law-of-debugging)
- [Red Flags - STOP Immediately If You Think](#red-flags---stop-immediately-if-you-think)
- [CRITICAL: Automated Verification First](#critical-automated-verification-first)
- [Regression Tests: Project Directory, NOT /tmp/](#regression-tests-project-directory-not-tmp)
- [The Four Phases](#the-four-phases-per-iteration)
- [Logging](#logging)
- [If Max Iterations Reached](#if-max-iterations-reached)

# Systematic Debugging

## Start Ralph Loop in Main Chat

**Main chat starts the loop, then spawns Task agents for debugging work.**

Task agents cannot reliably invoke ralph-loop (argument parsing breaks with complex prompts).
Instead: main chat runs the loop and delegates code investigation to Task agents.

### Step 1: Start the Ralph Loop

```
/ralph-wiggum:ralph-loop "Debug: [SYMPTOM]" --max-iterations 15 --completion-promise "FIXED"
```

### Step 2: Inside Each Iteration

Spawn a Task agent for the actual debugging work:

```
Task(subagent_type="general-purpose", prompt="""
Debug [SYMPTOM] following systematic protocol.

Context:
- Read .claude/SPEC.md for test command and requirements
- Read .claude/LEARNINGS.md for prior attempts and ruled-out hypotheses

Debugging Protocol:
1. Add debug logging to suspected code path
2. Rebuild/restart the project
3. Write test that RUNS the program and reproduces bug via LOGS
4. Run test, confirm it FAILS, paste LOG OUTPUT in LEARNINGS.md
5. Form ONE hypothesis about root cause
6. Test hypothesis with minimal change
7. If wrong: log what was ruled out in LEARNINGS.md
8. If right: apply fix, run test, confirm PASS (paste log output)
9. Run full test suite
10. Document root cause in LEARNINGS.md

See [Testing Rules](../dev/_shared/testing-rules.md) for LOGGING-FIRST, GREP TESTS BANNED, and SKIP != PASS rules.

Report back: hypothesis tested, results, root cause if found, any blockers.
""")
```

### Step 3: Verify and Complete

After Task agent returns, main chat verifies:
- [ ] Regression test RUNS the compiled binary or executes code paths
- [ ] Test checks LOGS or output for expected behavior
- [ ] NO grepping source files as tests
- [ ] Test failed before fix (RED documented with LOG output)
- [ ] Test passes after fix (GREEN documented with LOG output)
- [ ] All existing tests PASS (SKIP ≠ PASS)
- [ ] Root cause documented in LEARNINGS.md

**Only when ALL criteria verified, output:**
```
<promise>FIXED</promise>
```

### Step 4: If Bug Not Fixed → Keep Iterating

<EXTREMELY-IMPORTANT>
**KEEP LOOPING UNTIL REGRESSION TEST PASSES. Do NOT ask user to verify manually.**

If bug not fixed or criteria not met:
1. **Do NOT** output `<promise>FIXED</promise>`
2. **Do NOT** ask user to manually verify the fix
3. **DO** spawn another Task agent to continue investigation
4. **DO** keep iterating until automated regression test passes

The ralph loop continues until:
- Regression test passes (bug confirmed fixed), OR
- Max iterations reached (then escalate with specifics, don't ask for manual testing)

**Manual verification is LAST RESORT and requires explicit user request.**
</EXTREMELY-IMPORTANT>

### Automated Verification Hierarchy

Before asking user to verify, exhaust these options:

| Priority | Test Type | Tools |
|----------|-----------|-------|
| 1 | Regression test | meson test, pytest, jest |
| 2 | Integration | CLI reproduction, API calls, D-Bus |
| 3 | UI automation | Playwright (web), ydotool (desktop) |
| 4 | Visual | Screenshots via grim, snapshots |
| 5 | Manual | **ONLY if user explicitly requests** |

See `/dev-test` skill for platform-specific automation.

<EXTREMELY-IMPORTANT>
### Tool Availability Gate

**Before attempting UI/desktop automation, verify tools are installed.**

If ydotool, grim, wtype, or other required tools are missing:
1. **STOP** - Do not proceed
2. **TELL USER** - What tool is needed + install command
3. **WAIT** - For user to confirm installation

See `/dev-test` skill for full tool check protocol.

**Do NOT skip tests because tools are missing. Do NOT silently fail.**
</EXTREMELY-IMPORTANT>

---

## Reference: Debug Protocol (for the Task agent)

<EXTREMELY-IMPORTANT>
## The Iron Law of Debugging

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. This is not negotiable.**

Before writing ANY fix, you MUST:
1. Reproduce the bug
2. Trace the data flow
3. Form a specific hypothesis
4. Test that hypothesis
5. Only THEN write a fix (with a failing test first!)

**If you catch yourself about to write a fix without investigation, STOP.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "Let's just try this fix" | You're guessing, not debugging | Investigate first |
| "I'm pretty sure it's this" | "Pretty sure" isn't root cause | Gather evidence |
| "This should work" | Hope is not a debugging strategy | Test your hypothesis |
| "Let me change a few things" | Multiple changes = can't learn | ONE hypothesis at a time |
| "I reproduced it mentally" | Mental reproduction isn't evidence | Run test, see it FAIL |
| "I'll write the test after fixing" | That's verification, not TDD | Write test first, see RED |

## CRITICAL: Automated Verification First

**NEVER ask user to verify a fix if automated testing is possible.**

Verification hierarchy (try in order):
1. **Unit tests** - Write test that reproduces bug, verify it passes after fix
2. **Integration tests** - API/CLI verification
3. **UI automation** - Computer control + screenshots
4. **Manual verification** - LAST RESORT ONLY

## Regression Tests: Project Directory, NOT /tmp/

**Write regression tests in the project's test directory, not /tmp/.**

The bug fix isn't complete until there's a regression test that:
- Lives in the project (version controlled)
- Runs with the test suite (`ninja test`, `pytest`, etc.)
- Fails before fix, passes after

| Bad | Good |
|-----|------|
| `/tmp/test_bug_123.sh` | `tests/test_bug_123.sh` |
| Verified manually | Regression test added |

## The Four Phases (per iteration)

1. **Investigate** - Reproduce, trace data flow, gather evidence
2. **Analyze** - Compare to working code, find differences
3. **Hypothesize** - ONE specific hypothesis, test minimally
4. **Fix** - Only after confirmed: failing test → targeted fix → verify

## Logging

Append each hypothesis to `.claude/LEARNINGS.md`. See [LEARNINGS.md Template](../dev/_shared/learnings-template.md) for the required format with explicit RED/GREEN phases.

## If Max Iterations Reached

Ralph exits after max iterations. **Still do NOT ask user to manually verify.**

Main chat should:
1. **Summarize** hypotheses tested (from LEARNINGS.md)
2. **Report** what was ruled out and what remains unclear
3. **Ask user** for direction:
   - "Tested hypotheses A, B, C - all ruled out. Options:"
   - A) Start new loop with different investigation angle
   - B) Add more logging to specific code path
   - C) User provides additional context about the bug
   - D) User explicitly requests manual verification

**Never default to "please verify the fix manually".** Always exhaust automation first.
