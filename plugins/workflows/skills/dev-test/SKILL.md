---
name: dev-test
description: "REQUIRED for verifying implementation. Covers REAL automated tests: unit tests, integration tests, Playwright (web), ydotool (desktop), screenshots. Grepping is NOT testing. Log checking is NOT testing."
---

## Contents

- [The Iron Law of Automated Testing](#the-iron-law-of-automated-testing)
- [REAL Tests vs FAKE Tests](#real-tests-vs-fake-tests)
- [Gate Function: Before Claiming Tested](#gate-function-before-claiming-tested)
- [Testing Hierarchy](#testing-hierarchy)
- [Test Discovery](#test-discovery)
- [Platform-Specific Testing](#platform-specific-testing)
- [Output Requirements](#output-requirements)
- [Rationalization Prevention](#rationalization-prevention)
- [Red Flags](#red-flags---stop-if-youre-about-to)

# Automated Testing

<EXTREMELY-IMPORTANT>
## Your Job is to Write Automated Tests

**The automated test IS your deliverable. The implementation just makes the test pass.**

Reframe your task:
- ❌ "Implement feature X, and test it"
- ✅ "Write an automated test that proves feature X works. Then make it pass."

The test proves value. The implementation is a means to an end.

Without a REAL automated test (executes code, verifies behavior), you have delivered NOTHING.
</EXTREMELY-IMPORTANT>

**TESTING IS THE TASK.** Implementation without REAL automated tests is incomplete.

<EXTREMELY-IMPORTANT>
## The Iron Law of Automated Testing

**EXECUTE THE CODE. VERIFY THE BEHAVIOR. PASTE THE OUTPUT. This is not negotiable.**

A test is only valid if it:
1. **EXECUTES** the actual code (not grep, not ast-grep, not log reading)
2. **VERIFIES** runtime behavior (function returns X, UI shows Y, API responds Z)
3. **PRODUCES OUTPUT** that proves pass/fail (pasted to LEARNINGS.md)

"It should work" is NOT evidence. "Grep found it" is NOT evidence. "Logs say success" is NOT evidence.

**TEST OUTPUT IS THE ONLY EVIDENCE.**

**If you catch yourself about to claim "tested" without executing code, STOP.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## REAL Tests vs FAKE Tests

### This is the MOST IMPORTANT distinction. Read it carefully.

| ✅ REAL TEST (EXECUTE + VERIFY) | ❌ FAKE "TEST" (NEVER ACCEPTABLE) |
|---------------------------------|-----------------------------------|
| `pytest test_foo.py` → calls function, asserts return | `grep "def foo"` → confirms function exists |
| `playwright.click()` → clicks button, checks DOM | `ast-grep` → finds pattern in source |
| `ydotool type "input"` → simulates user, screenshot | Reading logs for "success" message |
| `curl http://api/endpoint` → checks response body | "The code looks correct" |
| `./binary --test` → runs binary, checks stdout | "I'm confident it works" |
| `meson test -C build` → runs compiled tests | Reviewing the implementation |

### Why Grepping/Log-Reading is NOT Testing

| Fake Approach | Why It's Worthless | What Happens |
|---------------|-------------------|--------------|
| `grep "function_name"` | Proves function exists, not that it works | Bug ships, user finds it |
| `ast-grep pattern` | Proves structure matches, not behavior | Runtime crash |
| "Log says success" | Log was written, code might not run | Silent failure |
| "Code review passed" | Human opinion, not execution | Edge cases missed |

### The Difference in One Sentence

**REAL test:** Code executes, behavior is verified, output proves it.
**FAKE test:** Code exists, structure looks right, you hope it works.

**ONLY REAL TESTS COUNT. FAKE TESTS ARE LYING.**
</EXTREMELY-IMPORTANT>

## Gate Function: Before Claiming "Tested"

```
BEFORE claiming anything is tested:

1. IDENTIFY → What command EXECUTES the code?
   - NOT grep, NOT ast-grep, NOT log reading
   - Must be: pytest, playwright, ydotool, curl, ./binary, etc.

2. RUN → Execute the command, capture full output

3. VERIFY → Does output show expected behavior?
   - Function returned correct value?
   - UI showed expected element?
   - API responded with expected data?

4. PASTE → Full output into LEARNINGS.md

5. ONLY THEN → Claim "tested"

Skip ANY step = not tested = lying
```

<EXTREMELY-IMPORTANT>
## CRITICAL: Tool Availability Gate

**If a required testing tool is not installed, STOP and tell the user to install it.**

Before attempting automation, verify tools exist:

```bash
# Check availability
which ydotool || echo "MISSING: ydotool"
which grim || echo "MISSING: grim"
which wtype || echo "MISSING: wtype"
# For Playwright, check MCP tools are available
```

**If ANY required tool is missing:**

1. **STOP** - Do not proceed with testing
2. **TELL USER** - Exactly what tool is needed and why
3. **PROVIDE INSTALL COMMAND** - Give them the exact command
4. **WAIT** - Do not continue until user confirms installation

Example response when tool missing:
```
STOP: Cannot proceed with UI automation.

Missing tool: ydotool (required for Wayland input simulation)

Install with:
  sudo pacman -S ydotool    # Arch
  sudo apt install ydotool  # Debian/Ubuntu

After installing, start the daemon:
  sudo systemctl enable --now ydotool

Reply when installed and I'll continue testing.
```

**DO NOT:**
- Skip the test because tool is missing
- Fall back to manual testing silently
- Continue and let the test fail
- Assume the tool will be available

**This gate is non-negotiable. Missing tools = full stop.**
</EXTREMELY-IMPORTANT>

## Testing Hierarchy

Try in order. Only fall back when higher options unavailable:

| Priority | Type | Tools | When to use |
|----------|------|-------|-------------|
| 1 | **Unit tests** | meson test, pytest, jest, cargo test | Always first |
| 2 | **Integration tests** | CLI invocation, API calls, D-Bus | Test component interaction |
| 3 | **UI automation** | Playwright (web), ydotool (desktop), D-Bus | Test user-facing behavior |
| 4 | **Visual regression** | Screenshots + comparison | Verify visual output |
| 5 | **Accessibility** | AT-SPI, axe-core | Verify a11y compliance |
| 6 | **Manual testing** | User verification | **LAST RESORT ONLY** |

## Code Search for Tests

**Use ast-grep to find existing test patterns:**

```bash
# Find test functions
sg -p 'def test_$NAME($$$):' --lang python
sg -p 'it($DESC, $$$)' --lang javascript

# Find test fixtures
sg -p '@pytest.fixture' --lang python

# Find assertions
sg -p 'assert $EXPR' --lang python
```

See `/dev-explore` for full ast-grep and ripgrep-all (rga) reference.

## Test Discovery

Before running tests, discover what's available:

### Project Test Infrastructure

```bash
# Find test directory
ls -d tests/ test/ spec/ __tests__/ 2>/dev/null

# Find test framework
cat meson.build 2>/dev/null | grep -i test
cat package.json 2>/dev/null | grep -i test
cat pyproject.toml 2>/dev/null | grep -i pytest
cat Cargo.toml 2>/dev/null | grep -i "\[dev-dependencies\]"
```

### Available System Tools

```bash
# Desktop automation (Wayland)
which ydotool  # Input simulation
which grim     # Screenshots
which slurp    # Region selection

# D-Bus (app control)
which dbus-send
which gdbus

# Accessibility
which accerciser  # AT-SPI browser
python3 -c "import pyatspi" 2>/dev/null && echo "pyatspi available"
```

### Available MCP Tools

Check for:
- **Playwright MCP** - Web browser automation
- **Accessibility MCP** - If available

## Platform-Specific Testing

### Web Applications (Playwright MCP)

```
# Navigate and snapshot
mcp__playwright__browser_navigate(url="http://localhost:3000")
mcp__playwright__browser_snapshot()

# Interact and verify
mcp__playwright__browser_click(element="Submit button", ref="button[type=submit]")
mcp__playwright__browser_wait_for(text="Success")
mcp__playwright__browser_snapshot()
```

**Verification pattern:**
1. Navigate to page
2. Take snapshot (accessibility tree)
3. Perform action
4. Wait for expected result
5. Take final snapshot
6. Verify expected elements present

### Desktop Applications (Linux/Wayland)

#### D-Bus Control (Preferred for apps that support it)

```bash
# List available D-Bus services
dbus-send --session --print-reply --dest=org.freedesktop.DBus \
  /org/freedesktop/DBus org.freedesktop.DBus.ListNames | grep -i appname

# Zathura example: open document
dbus-send --print-reply --dest=org.pwmt.zathura.PID-XXXX \
  /org/pwmt/zathura org.pwmt.zathura.OpenDocument string:"/path/to/file.pdf"

# Zathura: go to page
dbus-send --print-reply --dest=org.pwmt.zathura.PID-XXXX \
  /org/pwmt/zathura org.pwmt.zathura.GotoPage uint32:5
```

#### Input Simulation (ydotool for Wayland)

```bash
# Keyboard input
ydotool key 29:1 46:1 46:0 29:0  # Ctrl+C

# Type text
ydotool type "hello world"

# Mouse click at coordinates
ydotool mousemove --absolute 100 200
ydotool click 1  # Left click
```

**Note:** ydotool requires ydotoold daemon running.

#### Screenshots (Visual Verification)

```bash
# Full screen
grim /tmp/screenshot.png

# Specific window (get geometry first)
hyprctl clients -j | jq '.[] | select(.class=="zathura")'
grim -g "X,Y WxH" /tmp/window.png

# Compare to baseline (if exists)
compare -metric AE baseline.png /tmp/screenshot.png diff.png
```

#### Accessibility Testing (AT-SPI)

```python
#!/usr/bin/env python3
import pyatspi

# Find application
desktop = pyatspi.Registry.getDesktop(0)
for app in desktop:
    if "zathura" in app.name.lower():
        print(f"Found: {app.name}")
        # Traverse accessibility tree
        for child in app:
            print(f"  {child.getRole()}: {child.name}")
```

### C/Meson Projects (like Zathura)

```bash
# Run all tests
meson test -C build

# Run specific test
meson test -C build test_name

# With verbose output
meson test -C build -v

# Check test results
cat build/meson-logs/testlog.txt
```

### CLI Applications

```bash
# Run with test inputs
./app --test-mode input.txt > output.txt

# Compare to expected
diff expected.txt output.txt

# Check exit code
./app --validate file && echo "PASS" || echo "FAIL"
```

## Output Requirements

**Every test run MUST be documented in LEARNINGS.md:**

```markdown
## Test Run: [Description]

**Command:**
```bash
meson test -C build -v
```

**Output:**
```
1/5 test_parser        OK       0.12s
2/5 test_renderer      OK       0.34s
3/5 test_input         OK       0.08s
4/5 test_plugin        FAIL     0.45s
5/5 test_config        OK       0.11s

FAILED: test_plugin
Expected: X
Got: Y
```

**Result:** 4/5 PASS, 1 FAIL

**Next:** Fix test_plugin failure
```

## Rationalization Prevention

These thoughts mean STOP—you're about to fake test:

| Thought | Reality | Do Instead |
|---------|---------|------------|
| "Grep confirms the code exists" | Existence ≠ working | Execute the code |
| "The logs show it ran" | Logs can lie, behavior matters | Verify output/behavior |
| "ast-grep found the pattern" | Pattern ≠ functionality | Call the function |
| "I'm confident it works" | Confidence ≠ evidence | Run the test |
| "The code looks correct" | Looking ≠ testing | Execute and verify |
| "I'll add real tests later" | Later = never | Test now |
| "This is hard to test" | Playwright/ydotool exist | Use automation tools |
| "User can verify quickly" | Your job, not theirs | Automate it |
| "No test framework exists" | pytest/jest take 2 min | Create one |
| "Just this once" | Slippery slope to always | No exceptions |

**If you're rationalizing, you're about to lie. STOP and write a REAL test.**

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Use grep as "verification" | Grep doesn't execute code | Run pytest/jest/etc |
| Say "logs show success" | Log existence ≠ behavior | Verify actual output |
| Claim tested via code review | Review ≠ execution | Execute the code |
| Ask user to test manually | Automation likely possible | Find automated approach |
| Claim "it works" without output | No evidence | Run tests, paste output |
| Skip visual verification for UI | Bugs hide in rendering | Take screenshots |
| Ignore failing tests | "It's probably fine" isn't | Fix or explain |
| Use only unit tests for UI changes | Doesn't test user experience | Add UI automation |

## Testing Checklist

Before claiming implementation complete:

- [ ] REAL tests exist (execute code, verify behavior)
- [ ] NOT fake tests (no grep, no ast-grep, no log reading)
- [ ] Test output pasted to LEARNINGS.md
- [ ] Output shows PASS (not "should work")
- [ ] No skipped tests (SKIP ≠ PASS)
- [ ] UI changes verified via Playwright/ydotool/screenshots
