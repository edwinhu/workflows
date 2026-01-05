---
name: dev-test
description: This skill should be used when the user asks to "run tests", "verify the implementation works", "automate testing", or needs to run automated tests including UI/desktop automation. Covers unit tests, integration tests, web automation (playwright), and desktop automation (D-Bus, ydotool, screenshots).
---

## Contents

- [The Iron Law of Testing](#the-iron-law-of-testing)
- [Testing Hierarchy](#testing-hierarchy)
- [Test Discovery](#test-discovery)
- [Platform-Specific Testing](#platform-specific-testing)
- [Output Requirements](#output-requirements)
- [Red Flags](#red-flags---stop-if-youre-about-to)

# Automated Testing

Run real automated tests. Never ask user to test manually if automation is possible.

<EXTREMELY-IMPORTANT>
## The Iron Law of Testing

**RUN THE TESTS. PASTE THE OUTPUT. This is not negotiable.**

Before claiming anything works:
1. Identify available testing tools
2. Run actual test commands
3. Paste full output into LEARNINGS.md
4. Only claim success after seeing PASS

"It should work" is NOT evidence. Test output IS evidence.

**If you catch yourself about to ask user to test manually, STOP and find automated alternative.**
</EXTREMELY-IMPORTANT>

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

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Ask user to test manually | Automation likely possible | Find automated approach |
| Claim "it works" without output | No evidence | Run tests, paste output |
| Skip visual verification for UI | Bugs hide in rendering | Take screenshots |
| Ignore failing tests | "It's probably fine" isn't | Fix or explain |
| Use only unit tests for UI changes | Doesn't test user experience | Add UI automation |

## Testing Checklist

Before claiming implementation complete:

- [ ] Unit tests run and pass (paste output)
- [ ] Integration tests run (if applicable)
- [ ] UI changes verified via automation or screenshots
- [ ] No skipped tests (SKIP ≠ PASS)
- [ ] Test output documented in LEARNINGS.md
- [ ] Visual regression checked (for UI changes)
