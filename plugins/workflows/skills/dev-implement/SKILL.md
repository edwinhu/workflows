---
name: dev-implement
description: This skill should be used when the user asks to "implement with TDD", "write tests first", "do test-driven development", or as Phase 5 of the /dev workflow. Enforces RED-GREEN-REFACTOR cycle with mandatory test-first approach.
---

## Contents

- [Prerequisites](#prerequisites)
- [Start Ralph Loop in Main Chat](#start-ralph-loop-in-main-chat)
- [Reference: TDD Protocol](#reference-tdd-protocol-for-the-task-agent)
- [STOP - Read This First](#stop---read-this-first)
- [The Iron Law of TDD](#the-iron-law-of-tdd)
- [Red Flags - STOP Immediately If You Think](#red-flags---stop-immediately-if-you-think)
- [The TDD Cycle](#the-tdd-cycle-follow-this-exactly)
- [CRITICAL: Automated Testing First](#critical-automated-testing-first)
- [Test Location: Project Directory, NOT /tmp/](#test-location-project-directory-not-tmp)
- [Testing Anti-Patterns - NEVER DO THESE](#testing-anti-patterns---never-do-these)
- [Logging](#logging)
- [If Max Iterations Reached](#if-max-iterations-reached)

# Implementation

<EXTREMELY-IMPORTANT>
## Prerequisites

**Do NOT start implementation without these:**

1. `.claude/SPEC.md` exists with final requirements
2. `.claude/PLAN.md` exists with chosen approach
3. **User explicitly approved** in /dev-design phase

If any prerequisite is missing, STOP and complete the earlier phases.

**Check PLAN.md for:** files to modify, implementation order, testing strategy.
</EXTREMELY-IMPORTANT>

## Start Ralph Loop in Main Chat

**Main chat starts the loop, then spawns Task agents for code work.**

Task agents cannot reliably invoke ralph-loop (argument parsing breaks with complex prompts).
Instead: main chat runs the loop and delegates code edits to Task agents.

### Step 1: Start the Ralph Loop

```
/ralph-wiggum:ralph-loop "Implement [FEATURE]" --max-iterations 30 --completion-promise "DONE"
```

### Step 2: Inside Each Iteration

Spawn a Task agent for the actual implementation work:

```
Task(subagent_type="general-purpose", prompt="""
Implement [FEATURE] following TDD protocol.

Context:
- Read .claude/LEARNINGS.md for prior attempts
- Read .claude/SPEC.md for requirements
- Read .claude/PLAN.md for chosen approach and implementation order

TDD Protocol:
1. BEFORE writing test: Add debug logging to code path you'll test
2. Rebuild the project
3. Write failing test that RUNS the program and checks LOGS/output
4. Run test, see it FAIL, document RED in LEARNINGS.md (paste log output)
5. Implement minimal code to pass
6. Run test, see it PASS, document GREEN in LEARNINGS.md (paste log output)
7. Run full test suite
8. Refactor while staying GREEN

See [Testing Rules](../dev/_shared/testing-rules.md) for LOGGING-FIRST, GREP TESTS BANNED, and SKIP != PASS rules.

Report back: what was done, test results, any blockers.
""")
```

### Step 3: Verify and Complete

After Task agent returns, main chat verifies:
- [ ] Tests RUN the compiled binary or execute code paths
- [ ] Tests check LOGS or output for expected behavior
- [ ] NO grepping source files as tests
- [ ] All tests PASS (SKIP ≠ PASS)
- [ ] LEARNINGS.md contains ACTUAL LOG OUTPUT
- [ ] Build succeeds

**Only when ALL criteria verified, output:**
```
<promise>DONE</promise>
```

### Step 4: If Tests Fail → Keep Iterating

<EXTREMELY-IMPORTANT>
**KEEP LOOPING UNTIL TESTS PASS. Do NOT ask user to test manually.**

If tests fail or criteria not met:
1. **Do NOT** output `<promise>DONE</promise>`
2. **Do NOT** ask user to manually verify
3. **DO** spawn another Task agent to fix the failing tests
4. **DO** keep iterating until automated tests pass

The ralph loop continues until:
- All automated tests pass, OR
- Max iterations reached (then escalate, don't ask for manual testing)

**Manual testing is LAST RESORT and requires explicit user request.**
</EXTREMELY-IMPORTANT>

### Automated Testing Hierarchy

Before asking user to test, exhaust these options:

| Priority | Test Type | Tools |
|----------|-----------|-------|
| 1 | Unit tests | meson test, pytest, jest |
| 2 | Integration | CLI, API calls, D-Bus |
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

## Reference: TDD Protocol (for the Task agent)

## STOP - Read This First

**Before writing ANY code, you must:**

1. Write a test that **runs the actual code** (not grep)
2. Run it and **paste the failure output** into LEARNINGS.md
3. Only then implement

See [LEARNINGS.md Template](../dev/_shared/learnings-template.md) for the required entry format with explicit RED/GREEN phases.

**If your entry doesn't have actual command output, you skipped TDD.**

**Wrote code before the test? DELETE IT. Start over.**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete
- Implement fresh from tests

<EXTREMELY-IMPORTANT>
## The Iron Law of TDD

**Write the failing test FIRST. See it FAIL. This is not negotiable.**

Before writing ANY implementation code, you MUST:
1. Write a test that will fail (because the feature doesn't exist yet)
2. Run the test and **SEE THE FAILURE OUTPUT** (RED)
3. Document in LEARNINGS.md: "RED: [test name] fails with [error message]"
4. Only THEN write implementation code
5. Run test again, **SEE IT PASS** (GREEN)
6. Document: "GREEN: [test name] now passes"

**The RED step is not optional.** If you haven't seen the test fail, you haven't done TDD.

**If you catch yourself about to write implementation code without seeing RED first, STOP.**
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately If You Think:

| Thought | Why It's Wrong | Do Instead |
|---------|----------------|------------|
| "I'll write the test after" | You're doing implementation-first, not TDD | Write failing test NOW |
| "This is too simple for TDD" | Simple code benefits most from TDD | Write failing test anyway |
| "Let me just fix this quickly" | Speed is not the goal, correctness is | Write failing test first |
| "I know the test will fail" | Knowing isn't seeing; you must RUN it | Run test, see RED output |
| "Grep test is good enough" | Grep checks strings, not behavior | Write tests that RUN the code |
| "User didn't approve yet" | Implementation requires approval | Complete /dev-design first |

## The TDD Cycle (Follow This Exactly)

```
RED → Run test, see failure, log to LEARNINGS.md
GREEN → Minimal code only, run test, see pass, log to LEARNINGS.md
REFACTOR → Clean up while staying green
```

**Every cycle requires:**
1. **RED** - Test that runs code (not grep!), see it fail, paste output to LEARNINGS.md
2. **GREEN** - Minimal implementation, see it pass, paste output to LEARNINGS.md
3. **REFACTOR** - Clean up while tests still pass

## CRITICAL: Automated Testing First

**NEVER ask user to test manually if automated testing is possible.**

Testing hierarchy (try in order):
1. **Unit tests** - `ninja test`, `pytest`, `npm test`, etc.
2. **Integration tests** - API calls, CLI commands
3. **UI automation** - Computer control + screenshots
4. **Manual testing** - LAST RESORT ONLY

## Test Location: Project Directory, NOT /tmp/

**Write tests in the project's test directory, not /tmp/.**

| Bad | Good |
|-----|------|
| `/tmp/test_feature.sh` | `tests/test_feature.sh` |
| `/tmp/test_api.py` | `tests/test_api.py` |

**Find the test directory first:**
```bash
ls -d tests/ test/ spec/ __tests__/ 2>/dev/null
find . -name "*test*.py" -o -name "*_test.go" | head -5
```

## Testing Anti-Patterns - NEVER DO THESE

| Anti-Pattern | Why It's Wrong | Fix |
|--------------|----------------|-----|
| **Grep tests** | Verify strings exist, not behavior | Test runtime behavior |
| **Test passes immediately** | Proves nothing - didn't see RED | Delete code, start over |
| **No failure output in logs** | No evidence of RED phase | Document: "RED: [error]" |

**The Iron Rule:** If your test doesn't execute the code path, it's not a test.

## Logging

Append each attempt to `.claude/LEARNINGS.md`. See [LEARNINGS.md Template](../dev/_shared/learnings-template.md) for the required format with explicit RED/GREEN phases.

## If Max Iterations Reached

Ralph exits after max iterations. **Still do NOT ask user to manually test.**

Main chat should:
1. **Summarize** what's failing (from LEARNINGS.md)
2. **Report** which automated tests fail and why
3. **Ask user** for direction:
   - "Tests X, Y, Z are failing. Options:"
   - A) Start new loop with different approach
   - B) Add more logging to debug
   - C) User provides guidance on the failure
   - D) User explicitly requests manual testing

**Never default to "please test manually".** Always exhaust automation first.

**Next step:** `/dev-review` for code review (only after tests pass)
