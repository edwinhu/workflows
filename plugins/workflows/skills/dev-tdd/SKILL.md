---
name: dev-tdd
description: "Test-Driven Development protocol. RED-GREEN-REFACTOR cycle with mandatory test-first approach."
---

**Announce:** "I'm using dev-tdd for test-driven development."

## Contents

- [The Iron Law](#the-iron-law-of-tdd)
- [The TDD Cycle](#the-tdd-cycle)
- [What Counts as a Test](#what-counts-as-a-test)
- [Logging TDD Progress](#logging-tdd-progress)
- [Rationalizations](#rationalization-prevention)

# Test-Driven Development

<EXTREMELY-IMPORTANT>
## The Iron Law of TDD

**WRITE THE FAILING TEST FIRST. SEE IT FAIL. This is not negotiable.**

Before writing ANY implementation code, you MUST:
1. Write a test that will fail (because the feature doesn't exist yet)
2. Run the test and **SEE THE FAILURE OUTPUT** (RED)
3. Document in LEARNINGS.md: "RED: [test name] fails with [error message]"
4. Only THEN write implementation code
5. Run test again, **SEE IT PASS** (GREEN)
6. Document: "GREEN: [test name] now passes"

**The RED step is not optional.** If you haven't seen the test fail, you haven't done TDD.
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

**Run it and SEE IT FAIL:**
```
$ pytest tests/test_auth.py::test_user_can_login -v
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

**Run and SEE IT PASS:**
```
$ pytest tests/test_auth.py::test_user_can_login -v
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

**Verify still GREEN:**
```
$ pytest tests/test_auth.py -v
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

Every TDD cycle MUST be documented in `.claude/LEARNINGS.md`:

```markdown
## TDD Cycle: [Feature/Test Name]

### RED
- **Test:** `test_feature_works()`
- **Run:** `pytest tests/test_feature.py::test_feature_works -v`
- **Output:**
```
FAILED - AssertionError: expected True, got None
```
- **Expected failure:** Feature not implemented yet

### GREEN
- **Implementation:** Added `feature_works()` function
- **Run:** `pytest tests/test_feature.py::test_feature_works -v`
- **Output:**
```
PASSED
```

### REFACTOR
- Extracted helper function
- Added type hints
- Tests still pass
```

## Rationalization Prevention

These thoughts mean STOP—you're about to skip TDD:

| Thought | Reality |
|---------|---------|
| "I'll write the test after" | That's verification, not TDD. Test FIRST. |
| "This is too simple for TDD" | Simple code benefits most from TDD. |
| "Let me just fix this quickly" | Speed isn't the goal. Correctness is. |
| "I know the test will fail" | Knowing isn't seeing. RUN it, see RED. |
| "Grep confirms it exists" | Existence ≠ working. Execute the code. |
| "I already have the code" | DELETE IT. Write test first, then reimplement. |
| "Test passed on first run" | Suspicious. Did you see RED first? |

**If your test doesn't fail first, you're not doing TDD.**

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Write implementation first | Not TDD | Write failing test first |
| Skip running the test | No evidence of RED | Run test, see failure |
| Claim "tested" without output | No proof | Paste actual output |
| Use grep as verification | Doesn't test behavior | Execute the code |
| Write test that passes immediately | Proves nothing | Test must fail first |

## Integration

This skill is invoked by:
- `dev-implement` - for TDD during implementation
- `dev-debug` - for regression tests during debugging

For testing tool options (Playwright, ydotool, etc.), see:
```
Skill(skill="workflows:dev-test")
```
