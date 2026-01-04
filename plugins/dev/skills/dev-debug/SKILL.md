---
name: dev-debug
description: This skill should be used when the user asks to "debug this", "fix this bug", "investigate this error", "find the root cause", or reports a bug that needs systematic investigation. Uses 4-phase methodology for root cause analysis.
---

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

LOGGING-FIRST RULE:
You cannot debug what you cannot observe. Before writing ANY test:
1. Add debug logging to suspected code (print, console.log, logger.debug, etc.)
2. Rebuild/restart
3. Write test that runs the program and checks the LOG/output

⚠️ GREP TESTS ARE BANNED ⚠️
NEVER use 'grep -q' or 'if grep' to check SOURCE FILES as a test.
- ❌ WRONG: grep -q 'fixed_function' src/module.py && echo PASS
- ✅ RIGHT: ./program --action 2>&1 | tee /tmp/test.log; ! grep -q 'ERROR' /tmp/test.log

⚠️ SKIP ≠ PASS ⚠️
If a test is skipped, it has NOT passed. Run it and see actual PASS output.

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

If not complete, iterate: spawn another Task agent to continue investigation.

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

Append each hypothesis to `.claude/LEARNINGS.md` with explicit RED/GREEN:

```markdown
## Hypothesis N: [theory] - [CONFIRMED/RULED OUT]

**Evidence:** [what pointed to this hypothesis]

**RED:** Wrote test `test_bug_repro()`. Ran it. Output:
```
FAIL: test_bug_repro - got wrong value / crashed / etc
```
This confirms the bug exists and test catches it.

**Fix:** [describe the fix applied]

**GREEN:** Ran test again. Output:
```
PASS: test_bug_repro
```

**Learned:** ...
```

**The RED section is mandatory.** You must see the bug fail in a test before fixing it.

## If Max Iterations Reached

Ralph exits after max iterations. Main chat can:
1. Check LEARNINGS.md for hypotheses tested
2. Start a new ralph-loop with narrowed focus (main chat, not Task agent)
3. Escalate to user with specific question (not "please test")
