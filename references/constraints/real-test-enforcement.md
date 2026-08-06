---
name: real-test-enforcement
description: Tests must execute code and verify runtime behavior — fake tests (grep, log-reading, code review) are not tests
applies-to: [dev, dev-tdd, dev-implement, dev-accept, dev-debug, dev-test, dev-test-gaps, dev-spec-reviewer]
---

## Rule

**THE TEST MUST EXECUTE THE CODE AND VERIFY RUNTIME BEHAVIOR.**

Grepping is NOT testing. Log reading is NOT testing. Code review is NOT testing.

| REAL TEST (execute + verify) | FAKE "TEST" (NEVER ACCEPTABLE) |
|------------------------------|--------------------------------|
| pytest calls function, asserts return | grep for function exists |
| Playwright clicks button, checks DOM | ast-grep finds pattern |
| ydotool types input, screenshot verifies | Log says "success" |
| CLI invocation checks stdout | "Code looks correct" |
| API request verifies response body | "I'm confident it works" |

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

### Protocol Mismatch Detection (Common Fake Test Trap)

| Production Uses | FAKE Test Uses | Result |
|-----------------|----------------|--------|
| WebSocket | HTTP | Wrong code path tested |
| GraphQL | REST mock | Wrong serialization |
| Async/await | Sync calls | Race conditions hidden |
| IPC (Electron) | Direct import | Process boundary skipped |
| CLI invocation | Function call | Argument parsing skipped |

**The full canonical reference:** `references/constraints/real-test-enforcement.md`

## Rationale

**Why this exists** — fake tests are worse than no tests. They create false confidence, ship bugs, and waste debugging time. When a fake test passes, the team believes the feature works. When it breaks in production, the fake test offers no signal. Fake tests are technical debt that actively misleads.

## Examples

### Correct

```
# Testing a CLI tool
subprocess.run(["python", "cli.py", "--flag"], capture_output=True)
assert "expected output" in result.stdout
```

### Incorrect

```
# "Testing" a CLI tool with grep
grep -r "def cli_function" src/
(Proves the function exists. Says nothing about whether it runs correctly.)
```

## Test Facts

- "Wired up" is testable — write a test that calls it. Complex setup is the signal that you need an integration test, not a reason to skip one. A unit test covers a unit; the user's workflow crosses multiple units — feature-level claims need the integration/E2E test.
- A log line saying "success" was written by the code under test — it proves execution, not correct output. Grep proves existence, not correctness. Citing either as verification is an unverified claim presented as fact; assert the output.
- "I'll write a real test later" — later tests never get written; promising one is dishonest scheduling. Write it now.

## Red Flags

- **About to grep for a function name instead of calling it** — STOP. That's a fake test. Write a real one.
- **"The log shows success"** — STOP. Logs prove execution, not correctness. Assert the output.
- **Changing assertion to make test pass** — STOP. The assertion is hiding a bug. Fix the code, not the test.
- **Testing different protocol than production** — STOP. Wrong code path. Use the production protocol.
- **"Looks correct from code review"** — STOP. Code review is not a test. Execute the code.
- **Testing with mocks when you could use the real thing** — STOP. Mock the seams, not the system under test.
