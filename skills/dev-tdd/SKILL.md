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
## Task Reframing: What Your Job Actually Is

**Your job is NOT to implement features. Your job is to write tests that prove features work.**

Reframe every task:
- ❌ "Implement user login"
- ✅ "Write a test that proves user login works. Then make it pass."

- ❌ "Fix the icon rendering bug"
- ✅ "Write a test that fails when icons render wrong. Then fix it."

**The test IS your deliverable. The implementation just makes the test pass.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Logging

**ALL CODE MUST USE FILE-BASED LOGGING. This is absolute.**

Every application, service, script, or test runner you write MUST write logs to a file:

- ✅ CLI apps: `./app > /tmp/app.log 2>&1 &`
- ✅ GUI apps: `./app --log-file=/tmp/app.log 2>&1 &`
- ✅ Web servers: `npm start > /tmp/server.log 2>&1 &`
- ✅ Test runners: `pytest -v > /tmp/test.log 2>&1`
- ✅ Build scripts: `./build.sh 2>&1 | tee /tmp/build.log`

**Why file-based logging is mandatory:**

| Without File Logs | With File Logs |
|-------------------|----------------|
| stdout disappears → can't verify | Permanent record → can read anytime |
| stderr lost → can't debug | Errors captured → can diagnose |
| "It worked" = no proof | Log file = proof of execution |
| Can't review after the fact | Can read logs later |
| No GATE 5 possible | GATE 5 enforces reading them |

### Rationalization Prevention (Logging)

| Excuse | Reality |
|--------|---------|
| "Stdout is enough" | Stdout disappears. You need a file to READ. |
| "I can see the output" | You can't see it after it scrolls by. FILE LOGS. |
| "App doesn't support --log-file" | Use `2>&1 \| tee /tmp/app.log` instead. |
| "Logs aren't necessary for simple scripts" | Simple scripts still need verification. ALWAYS log to file. |
| "I'll just look at the terminal" | Terminal output is ephemeral. FILE-BASED ONLY. |
| "stderr is good enough" | stderr isn't a file you can `cat`. Use file logs. |
| "Too much output to log" | That's why you READ the logs (GATE 5), not print them. |

### Log File Verification Pattern

After launching any code, verify the log file was created:

```bash
# Launch with logging
./app > /tmp/app.log 2>&1 &
APP_PID=$!
sleep 2

# VERIFY LOG FILE EXISTS AND HAS CONTENT
if [ ! -f /tmp/app.log ]; then
    echo "FAIL: Log file not created"
    echo "Did you redirect stdout/stderr to a file?"
    exit 1
fi

if [ ! -s /tmp/app.log ]; then
    echo "FAIL: Log file empty (no output written)"
    exit 1
fi

echo "✓ Log file exists and has content"
```

**Tool description:** Verify log file exists and has content after launch

### The Honesty Requirement (Logging)

<EXTREMELY-IMPORTANT>
**Running code without file-based logging is LYING about verification.**

When you claim "code executed" or "tests ran", you are asserting:
- You created a log file
- You verified the log file exists
- You READ the full log file
- You confirmed what happened from the logs

Running without file logs means you have NO EVIDENCE of what happened.

**"I saw it in terminal" is not verification. File-based logs are mandatory.**
</EXTREMELY-IMPORTANT>
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Execution Gate (MANDATORY)

**NO E2E TESTS WITHOUT PASSING THE EXECUTION GATE FIRST. This is absolute.**

### The Gate Sequence

Before ANY E2E testing, screenshots, or verification:

```
┌─────────────────────────────────────────────────────────────┐
│ GATE 1: BUILD                                                │
│   → Compile/build the application                            │
│   → Exit code 0? → Proceed                                   │
│   → Exit code ≠ 0? → STOP, fix build, restart               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GATE 2: LAUNCH                                               │
│   → Start application with FILE-BASED logging                │
│   → ./app --log-file=/tmp/app.log 2>&1 &                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GATE 3: WAIT                                                 │
│   → sleep 2-3 seconds for initialization                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GATE 4: CHECK PROCESS                                        │
│   → ps -p $PID or pgrep appname                             │
│   → Running? → Proceed                                       │
│   → Crashed? → STOP, READ LOGS, fix, restart at GATE 1      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GATE 5: READ LOGS (MANDATORY - CANNOT SKIP)                 │
│   → cat /tmp/app.log                                         │
│   → Read ENTIRE log file                                     │
│   → Document what you see                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ GATE 6: VERIFY LOGS                                          │
│   → Check for ERROR, FATAL, Segmentation, core dumped       │
│   → Check for missing resources, failed loads                │
│   → Errors found? → STOP, fix, restart at GATE 1            │
│   → Clean logs? → Proceed                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ NOW YOU MAY: E2E tests, screenshots, UI verification         │
└─────────────────────────────────────────────────────────────┘
```

**YOU CANNOT SKIP GATES. YOU CANNOT REORDER GATES.**

### Red Flags - STOP Immediately

If you catch yourself thinking ANY of these, STOP—you're about to skip a gate:

| Thought | Why It's Wrong | Action |
|---------|----------------|--------|
| "Build succeeded, let me screenshot" | You skipped GATES 2-6 | Go to GATE 2 |
| "Let me take a screenshot" | You skipped GATES 1-6 | Start at GATE 1 |
| "Process is running, let me test" | You skipped GATES 5-6 (READ LOGS) | Go to GATE 5 |
| "I'll check logs if test fails" | Backward—logs come BEFORE tests | Go to GATE 5 |
| "Sleep is enough" | Sleep ≠ verification | Do GATES 4-6 |

### Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Build passed, app must work" | NO. GATES 2-6 required. Do them now. |
| "I can see the window" | NO. You haven't READ LOGS (GATE 5). Do it now. |
| "I'll check logs later" | NO. GATE 5 comes BEFORE E2E. Do it now. |
| "Logs are optional" | NO. GATE 5 is MANDATORY. Cannot skip. |
| "Screenshots will show issues" | NO. Screenshots can't show log errors. GATE 5 first. |

### For GUI Applications (Mandatory Pattern)

```bash
#!/bin/bash
set -e  # Exit on any error

# GATE 1: BUILD
echo "GATE 1: Building..."
cd build && ninja
echo "✓ GATE 1 PASSED"

# GATE 2: LAUNCH with file-based logging
echo "GATE 2: Launching with logging..."
./myapp --log-file=/tmp/myapp.log 2>&1 &
APP_PID=$!
echo "✓ GATE 2 PASSED (PID: $APP_PID)"

# GATE 3: WAIT
echo "GATE 3: Waiting for initialization..."
sleep 3
echo "✓ GATE 3 PASSED"

# GATE 4: CHECK PROCESS
echo "GATE 4: Checking process..."
if ! ps -p $APP_PID > /dev/null; then
    echo "✗ GATE 4 FAILED: Process crashed"
    echo "Reading logs from GATE 5..."
    cat /tmp/myapp.log
    exit 1
fi
echo "✓ GATE 4 PASSED"

# GATE 5: READ LOGS (MANDATORY)
echo "GATE 5: Reading full runtime logs..."
echo "=== RUNTIME LOGS ==="
cat /tmp/myapp.log
echo "=== END LOGS ==="
echo "✓ GATE 5 PASSED (logs read)"

# GATE 6: VERIFY LOGS
echo "GATE 6: Verifying no errors in logs..."
if grep -qE "(ERROR|FATAL|CRITICAL|Segmentation|core dumped)" /tmp/myapp.log; then
    echo "✗ GATE 6 FAILED: Errors found in logs"
    exit 1
fi
echo "✓ GATE 6 PASSED"

# NOW AND ONLY NOW: E2E testing
echo "All gates passed. Proceeding to E2E tests..."

# CRITICAL: Screenshot WINDOW ONLY, not whole screen
# Whole screen = other apps visible = false conclusions
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    # Wayland: Get focused window geometry and screenshot it
    GEOMETRY=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')
    grim -g "$GEOMETRY" /tmp/screenshot.png
else
    # X11: Screenshot active window only
    scrot -u /tmp/screenshot.png
fi
echo "Screenshot captured (window only)"
```

**Tool description:** Execute all 6 mandatory gates, then screenshot active window only

### The Iron Law of GUI E2E Testing

<EXTREMELY-IMPORTANT>
**GUI APPLICATIONS REQUIRE E2E TESTS WITH WINDOW-SPECIFIC SCREENSHOTS. This is absolute.**

Every GUI application you implement MUST have:
1. E2E test that verifies the UI
2. Screenshot of **THE APPLICATION WINDOW ONLY** (not whole screen)
3. Visual verification or comparison

**Why window-only screenshots are mandatory:**

| Whole Screen Screenshots | Window-Only Screenshots |
|--------------------------|-------------------------|
| Shows other apps → false conclusions | Shows your app only → accurate |
| "Success" message from wrong app | Only your app's messages |
| Icons from desktop/panel confuse analysis | Only your app's icons |
| Can't isolate your app's behavior | Isolated verification |

### Rationalization Prevention (Screenshots)

| Excuse | Reality |
|--------|---------|
| "Whole screen is easier" | Easier = wrong conclusions. Window only. |
| "I can tell which app it is" | You make mistakes. Isolate the window. |
| "Other apps don't matter" | They confuse verification. Window only. |
| "grim /tmp/screenshot.png works" | That's whole screen. Use `-g` with geometry. |
| "scrot is enough" | That's whole screen. Use `scrot -u` for active window. |

### Platform-Specific Window Screenshots

**Wayland (Hyprland):**
```bash
# Get active window geometry and screenshot it
GEOMETRY=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')
grim -g "$GEOMETRY" /tmp/window.png
```

**Wayland (Sway):**
```bash
# Get focused window geometry
GEOMETRY=$(swaymsg -t get_tree | jq -r '.. | select(.focused?) | .rect | "\(.x),\(.y) \(.width)x\(.height)"')
grim -g "$GEOMETRY" /tmp/window.png
```

**X11:**
```bash
# Screenshot active window only (-u flag)
scrot -u /tmp/window.png
```

**macOS:**
```bash
# Screenshot specific window by window ID
screencapture -l <window_id> /tmp/window.png
```

**Tool description:** Capture screenshot of application window only, not whole screen

### Feature-Specific Screenshot Cropping

<EXTREMELY-IMPORTANT>
**When testing a SPECIFIC feature (toolbar, dialog, icon set), crop to THAT REGION ONLY.**

**Why feature-specific cropping is mandatory:**

| Whole Window | Feature-Specific Crop |
|--------------|----------------------|
| Irrelevant UI elements visible | Only the feature being tested |
| False positives from other parts | Isolated verification |
| "Success" from unrelated element | Only the target element |
| Harder to spot actual bug | Bug is obvious in focused view |

**Example: Testing toolbar icons**

❌ **WRONG:** Screenshot whole window
```bash
# Shows entire app - toolbar is tiny, hard to verify
grim -g "$GEOMETRY" /tmp/screenshot.png
```

✅ **CORRECT:** Crop to toolbar only
```bash
# Get window geometry
GEOMETRY=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')

# Extract coordinates and crop to toolbar (top 50px of window)
X=$(echo $GEOMETRY | cut -d, -f1)
Y=$(echo $GEOMETRY | cut -d' ' -f1 | cut -d, -f2)
W=$(echo $GEOMETRY | cut -d' ' -f2 | cut -dx -f1)

# Screenshot toolbar only (top 50 pixels)
grim -g "$X,$Y ${W}x50" /tmp/toolbar.png
```

**Example: Testing specific dialog**

✅ **CORRECT:** Get dialog window geometry, screenshot that window only
```bash
# Get dialog window ID and geometry specifically
DIALOG_GEOMETRY=$(hyprctl clients -j | jq -r '.[] | select(.title | contains("Settings")) | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')
grim -g "$DIALOG_GEOMETRY" /tmp/dialog.png
```

### Rationalization Prevention (Feature Cropping)

| Excuse | Reality |
|--------|---------|
| "Whole window shows context" | Context confuses verification. Crop to feature. |
| "I can see the feature in the full screenshot" | You read wrong elements. Isolate the feature. |
| "Cropping is too much work" | 5 extra seconds prevents false conclusions. |
| "The whole window is relevant" | Only test what you changed. Crop to feature. |
| "I'll just focus on the right area" | You make mistakes. Force isolation via crop. |

**Tool description:** Crop screenshot to specific feature region being tested
</EXTREMELY-IMPORTANT>
</EXTREMELY-IMPORTANT>

### The Honesty Requirement

<EXTREMELY-IMPORTANT>
**Skipping gates is LYING about verification.**

When you say "E2E test passed", you are asserting:
- You passed GATE 1 (built successfully)
- You passed GATE 2 (launched with logging)
- You passed GATE 3 (waited for init)
- You passed GATE 4 (process is running)
- **You passed GATE 5 (READ the full log file)**
- **You passed GATE 6 (VERIFIED no errors in logs)**
- You ran E2E tests with clean logs

Saying "E2E passed" without completing GATES 5-6 is not "testing"—it is LYING about application state.

**"Checking logs now" is honest. "E2E verified" without GATE 5 is fraud.**
</EXTREMELY-IMPORTANT>
</EXTREMELY-IMPORTANT>

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
RED → Write test → Run through GATES → See failure → Read logs → Document
GREEN → Minimal code → Run through GATES → See pass → Read logs → Document
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

Run the test through the execution gates:

```bash
# For unit tests, minimum gates are: EXECUTE + READ OUTPUT
pytest tests/test_auth.py::test_user_can_login -v 2>&1 | tee /tmp/test.log
# pytest: run specific test and see RED failure

# READ the output (MANDATORY)
cat /tmp/test.log
```

Output will show:
```
FAILED - NameError: name 'login' is not defined
```

**Log to LEARNINGS.md:**
```markdown
## RED: test_user_can_login
- Test written
- Ran through gates (pytest executed, output read)
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

Run the test through gates again:

```bash
pytest tests/test_auth.py::test_user_can_login -v 2>&1 | tee /tmp/test.log
# pytest: run test again and see GREEN success

# READ the output (MANDATORY)
cat /tmp/test.log
```

Output will show:
```
PASSED
```

**Log to LEARNINGS.md:**
```markdown
## GREEN: test_user_can_login
- Minimal login() implemented
- Ran through gates (pytest executed, output read)
- Test passes
- No errors in output
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
   - Run through ALL 6 GATES (BUILD → LAUNCH → WAIT → CHECK → READ LOGS → VERIFY LOGS)
   - Only after GATE 6: Run the E2E test
   - Observe the failure (feature doesn't exist)
   - Document: "E2E RED: [test] fails with [error]. All gates passed, logs clean."

2. **GREEN**: Implement to make E2E pass (unit tests already green)
   - Run through ALL 6 GATES again
   - Only after GATE 6: Run the E2E test
   - Verify the pass
   - Document: "E2E GREEN: [test] passes. All gates passed, logs clean."

3. **REFACTOR**: Ensure both unit and E2E stay green
   - Continue running through gates for each test run

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
