---
name: dev-tdd
description: This skill should be used when the user asks to "implement using TDD", "test-driven development", "RED-GREEN-REFACTOR", or "write failing test first". Enforces test-first approach with RED-GREEN-REFACTOR cycle and execution-based verification.
version: 0.1.0
---

## Contents

- [The Iron Law](#the-iron-law-of-tdd)
- [The TDD Cycle](#the-tdd-cycle)
- [What Counts as a Test](#what-counts-as-a-test)
- [Logging TDD Progress](#logging-tdd-progress)
- [Red Flags - Thoughts That Mean STOP](#red-flags---thoughts-that-mean-stop)
- [Delete & Restart](#delete--restart)
- [E2E Test Requirement](#e2e-test-requirement)

# Test-Driven Development

<EXTREMELY-IMPORTANT>
## The Iron Law of TDD

**YOU MUST WRITE THE FAILING TEST FIRST. YOU MUST SEE IT FAIL. This is not negotiable.**

Before writing ANY implementation code:
1. You write a test that will fail (because the feature doesn't exist yet)
2. You run the test and **SEE THE FAILURE OUTPUT** (RED)
3. You document in LEARNINGS.md: "RED: [test name] fails with [error message]"
4. Only THEN you write implementation code
5. You run the test again, **SEE IT PASS** (GREEN)
6. You document: "GREEN: [test name] now passes"

**The RED step is not optional. If the test hasn't failed, you haven't practiced TDD.**
</EXTREMELY-IMPORTANT>

## The TDD Cycle

```
RED → Run test, see failure, log to LEARNINGS.md
GREEN → Minimal code only, run test, see pass, log to LEARNINGS.md
REFACTOR → Clean up while staying green
```

### Step 1: RED - Write Failing Test

```python
# Write the test FIRST
def test_user_can_login():
    result = login("user@example.com", "password123")
    assert result.success == True
    assert result.token is not None
```

Run the test and observe the failure:

```bash
pytest tests/test_auth.py::test_user_can_login -v
# pytest: run specific test and see RED failure
```

Output will show:
```
FAILED - NameError: name 'login' is not defined
```

**Log to LEARNINGS.md:**
```markdown
## RED: test_user_can_login
- Test written
- Fails with: NameError: name 'login' is not defined
- Expected: function doesn't exist yet
```

### Step 2: GREEN - Minimal Implementation

Write the **minimum code** to make the test pass:

```python
def login(email: str, password: str) -> LoginResult:
    # Minimal implementation
    return LoginResult(success=True, token="dummy-token")
```

Run the test and verify the pass:

```bash
pytest tests/test_auth.py::test_user_can_login -v
# pytest: run test again and see GREEN success
```

Output will show:
```
PASSED
```

**Log to LEARNINGS.md:**
```markdown
## GREEN: test_user_can_login
- Minimal login() implemented
- Test passes
- Ready for refactor
```

### Step 3: REFACTOR - Improve While Green

Clean up the code while keeping tests passing:

```python
def login(email: str, password: str) -> LoginResult:
    user = User.find_by_email(email)
    if user and user.check_password(password):
        return LoginResult(success=True, token=generate_token(user))
    return LoginResult(success=False, token=None)
```

Verify tests remain green after refactoring:

```bash
pytest tests/test_auth.py -v
# pytest: run all tests and verify GREEN after refactor
```

Output will show:
```
All tests PASSED
```

## What Counts as a Test

<EXTREMELY-IMPORTANT>
### REAL Tests vs FAKE "Tests"

| REAL TEST (execute + verify) | FAKE "TEST" (NEVER ACCEPTABLE) |
|------------------------------|--------------------------------|
| pytest calls function, asserts return | grep for function exists |
| Playwright clicks button, checks DOM | ast-grep finds pattern |
| ydotool types input, screenshot verifies | Log says "success" |
| CLI invocation checks stdout | "Code looks correct" |
| API request verifies response body | "I'm confident it works" |

**THE TEST MUST EXECUTE THE CODE AND VERIFY RUNTIME BEHAVIOR.**

Grepping is NOT testing. Log reading is NOT testing. Code review is NOT testing.
</EXTREMELY-IMPORTANT>

### Why Grepping is Not Testing

| Fake Approach | Why It's Worthless | What Happens |
|---------------|-------------------|--------------|
| `grep "function_name"` | Proves function exists, not that it works | Bug ships |
| `ast-grep pattern` | Proves structure matches, not behavior | Runtime crash |
| "Log says success" | Log was written, code might not run | Silent failure |
| "Code review passed" | Human opinion, not execution | Edge cases missed |

## Logging TDD Progress

Document every TDD cycle in `.claude/LEARNINGS.md`:

```markdown
## TDD Cycle: [Feature/Test Name]

### RED
- **Test:** `test_feature_works()`
- **Command:**

```bash
pytest tests/test_feature.py::test_feature_works -v
# pytest: run test and observe RED failure
```

- **Output:**
```
FAILED - AssertionError: expected True, got None
```
- **Expected:** Feature not implemented yet

### GREEN
- **Implementation:** Added `feature_works()` function
- **Command:**

```bash
pytest tests/test_feature.py::test_feature_works -v
# pytest: run test and verify GREEN success
```

- **Output:**
```
PASSED
```

### REFACTOR
- Extracted helper function
- Added type hints
- Verify tests still pass:

```bash
pytest tests/test_feature.py -v
# pytest: run all tests and confirm GREEN after refactor
```
```

## Red Flags - Thoughts That Mean STOP

If you catch yourself thinking these thoughts—STOP. They're indicators you're about to skip TDD:

| Thought | Reality |
|---------|---------|
| "Write the test after" | You're about to do verification, not TDD. You MUST test FIRST. |
| "This is too simple for TDD" | Your simple code benefits MOST from TDD. |
| "Just fix this quickly" | Your speed isn't the goal. Your correctness is. |
| "Know the test will fail" | You knowing isn't the same as you seeing it fail. You MUST RUN it, see RED. |
| "Grep confirms it exists" | Your existence check ≠ working code. You MUST execute the code. |
| "Already have the code" | You MUST DELETE IT. You write test first, then reimplement. |
| "Test passed on first run" | Suspicious. Did you actually see RED first? |

**If your test doesn't fail first, you haven't practiced TDD.**

## Delete & Restart

<EXTREMELY-IMPORTANT>
**Wrote implementation code before test? You MUST DELETE IT. No exceptions.**

When you discover implementation code that wasn't driven by a test:
1. **DELETE** your implementation code
2. **WRITE** the test first
3. **RUN** it, **SEE RED**
4. **REWRITE** the implementation

"But it works" is not an excuse. "But it would waste your time" is not an excuse.

**Code you wrote without TDD is UNTRUSTED code. You delete it and do it right.**
</EXTREMELY-IMPORTANT>

## E2E Test Requirement

<EXTREMELY-IMPORTANT>
### The Iron Law of E2E in TDD

**USER-FACING FEATURES REQUIRE E2E TESTS IN ADDITION TO UNIT TESTS.**

TDD cycle for user-facing changes:

```
Unit TDD:     RED → GREEN → REFACTOR
                    ↓
E2E TDD:      RED → GREEN → REFACTOR
```

**Both cycles must complete. Unit GREEN does not mean DONE.**

### When E2E is Required

| Change Type | Unit Tests | E2E Required? |
|-------------|------------|---------------|
| Internal logic | Yes | No |
| API endpoint | Yes | Yes (test full request/response) |
| UI component | Yes | **Yes** (Playwright/automation) |
| CLI command | Yes | Yes (test actual invocation) |
| User workflow | Yes | **Yes** (simulate user actions) |
| Visual change | Yes | **Yes** (screenshot comparison) |

### E2E TDD Cycle

1. **RED**: Write E2E test simulating user action
   - Run the E2E test and observe the failure (feature doesn't exist)
   - Document: "E2E RED: [test] fails with [error]"

2. **GREEN**: Implement to make E2E pass (unit tests already green)
   - Run the E2E test and verify the pass
   - Document: "E2E GREEN: [test] passes"

3. **REFACTOR**: Ensure both unit and E2E stay green

### Delete & Restart (E2E)

**You shipped user-facing code without E2E test? You MUST WRITE ONE NOW.**

Retroactive E2E is better than no E2E. But next time: You write E2E FIRST.
</EXTREMELY-IMPORTANT>

## Integration

This skill is invoked by:
- `dev-implement` - for TDD during implementation
- `dev-debug` - for regression tests during debugging

For testing tool options (Playwright, ydotool, etc.), see:
```
Skill(skill="workflows:dev-test")
```
