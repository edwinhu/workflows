---
name: dev-tdd
description: Test-Driven Development protocol. Write failing test first, then minimal implementation.
---

# Test-Driven Development (TDD)

## The Iron Law

**WRITE THE FAILING TEST FIRST. SEE IT FAIL. This is not negotiable.**

Before writing ANY implementation code:
1. Write a test that will fail (feature doesn't exist yet)
2. Run the test and **SEE THE FAILURE OUTPUT** (RED)
3. Only THEN write implementation code
4. Run test again, **SEE IT PASS** (GREEN)
5. Clean up code while keeping tests passing (REFACTOR)

**The RED step is not optional.** If you haven't seen the test fail, you haven't done TDD.

## The TDD Cycle

```
RED       → Write test, run it, see failure
GREEN     → Write minimal code, run test, see pass
REFACTOR  → Clean up while staying green
REPEAT    → For next feature
```

## RED - Write Failing Test

Write one minimal test that shows what should happen:

```python
# Write the test FIRST
def test_user_can_login():
    result = login("user@example.com", "password123")
    assert result.success == True
    assert result.token is not None
```

**Run it and SEE IT FAIL:**
```
$ pytest tests/test_auth.py::test_user_can_login -v
FAILED - NameError: name 'login' is not defined
```

**Document the failure:**
```
RED: test_user_can_login
- Test written
- Fails with: NameError: name 'login' is not defined
- Expected: function doesn't exist yet
```

## GREEN - Minimal Implementation

Write the **minimum code** to make the test pass. Don't over-engineer. Don't anticipate future features.

```python
def login(email: str, password: str) -> LoginResult:
    # Minimal implementation to pass test
    return LoginResult(success=True, token="dummy-token")
```

**Run and SEE IT PASS:**
```
$ pytest tests/test_auth.py::test_user_can_login -v
PASSED
```

**Document the pass:**
```
GREEN: test_user_can_login
- Minimal login() implemented
- Test passes
- Ready for refactor
```

## REFACTOR - Improve While Green

Now that the test passes, improve the code while keeping tests green:

```python
def login(email: str, password: str) -> LoginResult:
    user = User.find_by_email(email)
    if user and user.check_password(password):
        return LoginResult(success=True, token=generate_token(user))
    return LoginResult(success=False, token=None)
```

**Verify still GREEN:**
```
$ pytest tests/test_auth.py -v
All tests PASSED
```

## What Counts as a Test

A real test EXECUTES THE CODE and VERIFIES RUNTIME BEHAVIOR.

| REAL TEST (✓) | FAKE "TEST" (✗) |
|---------------|-----------------|
| pytest calls function, asserts return | grep for function exists |
| Playwright clicks button, checks DOM | ast-grep finds pattern |
| CLI invocation checks stdout | "Code looks correct" |
| API request verifies response | Log says "success" |
| Runs code, inspects actual output | Code review passes |

**Grepping is NOT testing. Code review is NOT testing. Log reading is NOT testing.**

### Why Grepping Fails

| Fake Approach | Why It Fails | Reality |
|---------------|-------------|---------|
| `grep "function_name"` | Proves function exists | Doesn't prove it works |
| `ast-grep pattern` | Proves structure matches | Doesn't prove behavior |
| "Log says success" | Log was written | Code might not execute |
| "Code review passed" | Opinion only | Runtime behavior unknown |

## Rationalization Prevention

These thoughts mean STOP—you're about to skip RED:

| Thought | Reality |
|---------|---------|
| "I know what the test will do" | Knowing ≠ running. Run it. |
| "The test is obvious" | Obvious tests catch dumb bugs. Write it. |
| "I've written the code already" | Then DELETE it. Start from test. |
| "I'll run the test later" | You won't. Run it now. |
| "Let me just write a quick test" | Quick = skipped RED. Not TDD. |
| "Grepping proves it exists" | Existence ≠ functionality. Run test. |
| "This is just configuration" | Config code gets bugs too. Test it. |

## Logging Every Cycle

For each test you write, document:

```
## TDD Cycle: [Feature Name]

### RED
- Test: test_user_can_login()
- Run: pytest tests/test_auth.py::test_user_can_login -v
- Output: FAILED - NameError: name 'login' is not defined
- Expected failure: Feature not implemented yet

### GREEN
- Code written: login() function in auth.py
- Run: pytest tests/test_auth.py::test_user_can_login -v
- Output: PASSED
- All tests still passing: yes

### REFACTOR
- Improvements: Added user lookup, password check
- Run full test suite: pytest tests/ -v
- All tests passing: yes
```

## Multiple Tests Per Feature

Most features need multiple tests:

```python
def test_login_with_valid_credentials():
    result = login("user@example.com", "correct-password")
    assert result.success == True

def test_login_with_invalid_password():
    result = login("user@example.com", "wrong-password")
    assert result.success == False

def test_login_with_nonexistent_email():
    result = login("nosuchuser@example.com", "anything")
    assert result.success == False
```

Each test gets its own RED-GREEN-REFACTOR cycle.

## Full Test Suite After Each Cycle

After GREEN on your new test, always run the full test suite:

```bash
pytest tests/
```

All tests must pass. If existing tests break, you've broken something. Fix it before moving on.

