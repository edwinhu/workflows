# Real Test Enforcement

This is the canonical source for real vs fake test enforcement rules. All dev workflow skills should reference this file instead of duplicating the content inline.

## REAL Tests vs FAKE "Tests"

| REAL TEST (execute + verify) | FAKE "TEST" (NEVER ACCEPTABLE) |
|------------------------------|--------------------------------|
| pytest calls function, asserts return | grep for function exists |
| Playwright clicks button, checks DOM | ast-grep finds pattern |
| ydotool types input, screenshot verifies | Log says "success" |
| CLI invocation checks stdout | "Code looks correct" |
| API request verifies response body | "I'm confident it works" |

**THE TEST MUST EXECUTE THE CODE AND VERIFY RUNTIME BEHAVIOR.**

Grepping is NOT testing. Log reading is NOT testing. Code review is NOT testing.

## Fake Tests That Look Like Tests (THE INSIDIOUS FAILURE)

**A test can EXECUTE code and still be FAKE if it tests the wrong thing.**

This is MORE dangerous than no tests because it creates FALSE CONFIDENCE.

| LOOKS LIKE A TEST | WHY IT'S FAKE | REAL TEST MUST DO |
|-------------------|---------------|-------------------|
| Tests different protocol | Wrong code path | Use same protocol as production |
| Calls function directly | Skips user workflow | Simulate actual user action |
| Checks internal state | User doesn't see that | Verify user-visible output |
| Uses mock/stub for SUT | Defeats the purpose | Test actual behavior |
| Ignores specified skill | "I know better" | Use the specified testing skill |
| Changes assertion to pass | Hides bugs | Question if test is valid |
| Skips async when prod is async | Race conditions hidden | Match async behavior |

## The Iron Law of REAL Tests

**If the test doesn't replicate what the user does, it's a FAKE test.**

Before running any test, verify:
1. Does test use SAME protocol as production?
2. Does test follow EXACT user workflow?
3. Does test verify what USER sees?
4. Does test use the SPECIFIED testing skill?

If ANY answer is "no" → DELETE THE TEST. Write a REAL one.

## Fake Test Detection (Red Flags)

If you catch yourself doing these, STOP - you're writing a FAKE test:

| What You're Doing | Why It's Fake | Do Instead |
|-------------------|---------------|------------|
| Testing different protocol | Wrong code path | Use production protocol |
| Calling function instead of user action | Skipping user workflow | Simulate actual user action |
| Changing assertion to make test pass | Hiding bugs, not finding them | Question if test is valid |
| Ignoring the testing skill user specified | Arrogance: "I know better" | Use the specified skill |
| Testing internal state | User doesn't see that | Test user-visible output |
| Mocking the System Under Test | Defeats the purpose | Test actual behavior |
| Using sync when production is async | Race conditions hidden | Match async behavior |
| Testing unit when integration needed | Boundary bugs hidden | Test across boundaries |

## When Tests Fail, Question the Test First

**If a test fails, don't immediately fix the assertion. Ask:**

1. Is this test testing the right thing?
2. Is this test using the right protocol?
3. Is this test replicating the user's workflow?
4. Did I use the specified testing skill?

If any answer is "no" → The test is wrong, not the assertion.

## Why Grepping is Not Testing

| Fake Approach | Why It's Worthless | What Happens |
|---------------|-------------------|--------------|
| `grep "function_name"` | Proves function exists, not that it works | Bug ships |
| `ast-grep pattern` | Proves structure matches, not behavior | Runtime crash |
| "Log says success" | Log was written, code might not run | Silent failure |
| "Code review passed" | Human opinion, not execution | Edge cases missed |
