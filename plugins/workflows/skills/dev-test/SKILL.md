---
name: dev-test
description: "Testing tools reference. Covers unit tests, integration tests, Playwright (web), ydotool (desktop), screenshots."
---

**Announce:** "I'm using dev-test to select testing tools."

## Where This Fits

```
Main Chat                          Task Agent (you)
─────────────────────────────────────────────────────
dev-implement
  → dev-ralph-loop
    → dev-delegate
      → Task agent ──────────────→ follows dev-tdd (TDD protocol)
                                   uses dev-test (this skill)
```

**This skill is for Task agents** selecting testing tools.
For TDD philosophy (RED-GREEN-REFACTOR), see `dev-tdd`.

## Contents

- [Testing Hierarchy](#testing-hierarchy)
- [Tool Availability Gate](#tool-availability-gate)
- [Test Discovery](#test-discovery)
- [Platform-Specific Testing](#platform-specific-testing)
- [Output Requirements](#output-requirements)

# Testing Tools Reference

## Testing Hierarchy

Try in order. Only fall back when higher options unavailable:

| Priority | Type | Tools | When to use |
|----------|------|-------|-------------|
| 1 | **Unit tests** | meson test, pytest, jest, cargo test | Always first |
| 2 | **Integration tests** | CLI invocation, API calls | Test component interaction |
| 3 | **UI automation** | Playwright (web), Hammerspoon (macOS), ydotool (Linux) | Test user-facing behavior |
| 4 | **Visual regression** | Screenshots + comparison | Verify visual output |
| 5 | **Accessibility** | AT-SPI, axe-core | Verify a11y compliance |
| 6 | **Manual testing** | User verification | **LAST RESORT ONLY** |

<EXTREMELY-IMPORTANT>
## Tool Availability Gate

**If a required testing tool is not installed, STOP and tell the user to install it.**

Before attempting automation, verify tools exist:

```bash
# macOS - Check Hammerspoon
which hs || echo "MISSING: hs CLI (run: hs.ipc.cliInstall() in Hammerspoon console)"
ls /Applications/Hammerspoon.app || echo "MISSING: Hammerspoon (brew install --cask hammerspoon)"

# Linux/Wayland - Check ydotool
which ydotool || echo "MISSING: ydotool"
which grim || echo "MISSING: grim"

# Cross-platform - Playwright MCP
# Check MCP tools are available
```

**If ANY required tool is missing:**

1. **STOP** - Do not proceed with testing
2. **TELL USER** - Exactly what tool is needed and why
3. **PROVIDE INSTALL COMMAND** - Give them the exact command
4. **WAIT** - Do not continue until user confirms installation

Example response when tool missing:
```
STOP: Cannot proceed with UI automation.

# macOS example:
Missing tool: Hammerspoon hs CLI (required for macOS automation)

Install with:
  brew install --cask hammerspoon
  # Then in Hammerspoon console: hs.ipc.cliInstall()
  # Add to ~/.hammerspoon/init.lua: require("hs.ipc")

Reply when installed and I'll continue testing.

# Linux example:
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
# macOS - Hammerspoon
which hs                    # CLI for automation scripts
ls /Applications/Hammerspoon.app  # Main app

# Linux/Wayland
which ydotool  # Input simulation
which grim     # Screenshots
which slurp    # Region selection

# D-Bus (Linux app control)
which dbus-send
which gdbus

# Accessibility
which accerciser  # AT-SPI browser (Linux)
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

### Desktop Applications (macOS - Hammerspoon)

Hammerspoon provides powerful macOS automation via Lua scripting.

**Setup (one-time):**
```lua
-- Add to ~/.hammerspoon/init.lua
require("hs.ipc")  -- Enables CLI
```

#### Running Automation Scripts

```bash
# Execute Lua code directly
hs -c 'hs.alert.show("Test started")'

# Execute a script file
hs /path/to/test_script.lua

# Pipe script via stdin
echo 'hs.alert.show("Hello")' | hs -s
```

#### Input Simulation (hs.eventtap)

```lua
-- Type text
hs.eventtap.keyStrokes("hello world")

-- Key press (with modifiers)
hs.eventtap.keyStroke({"cmd"}, "c")  -- Cmd+C
hs.eventtap.keyStroke({"cmd", "shift"}, "s")  -- Cmd+Shift+S

-- Mouse click at position
hs.eventtap.leftClick({x=100, y=200})
hs.eventtap.rightClick({x=100, y=200})

-- Mouse move
hs.mouse.absolutePosition({x=500, y=300})
```

#### Application Control (hs.application)

```lua
-- Launch or focus app
local app = hs.application.launchOrFocus("Safari")

-- Get running app
local app = hs.application.get("Safari")
if app then
    app:activate()  -- Bring to front
    app:kill()      -- Terminate
end

-- Wait for app to launch
hs.timer.waitUntil(
    function() return hs.application.get("MyApp") ~= nil end,
    function() print("App launched") end
)

-- Get frontmost app
local front = hs.application.frontmostApplication()
print(front:name())
```

#### Window Management

```lua
-- Get app's windows
local app = hs.application.get("Safari")
local wins = app:allWindows()
for _, win in ipairs(wins) do
    print(win:title())
    win:focus()  -- Focus this window
end

-- Get window by title
local win = hs.window.get("My Document")
if win then
    win:focus()
    win:maximize()
end
```

#### Screenshots (Visual Verification)

```bash
# Full screen
screencapture /tmp/screenshot.png

# Specific window (interactive)
screencapture -w /tmp/window.png

# Specific region
screencapture -R 100,200,800,600 /tmp/region.png

# No shadow, no sound
screencapture -o -x /tmp/clean.png
```

```lua
-- From Hammerspoon: capture focused window
local win = hs.window.focusedWindow()
if win then
    local img = win:snapshot()
    img:saveToFile("/tmp/window.png")
end
```

#### Complete E2E Test Example (macOS)

```lua
-- test_app_workflow.lua
-- Run with: hs /path/to/test_app_workflow.lua

-- 1. Launch app
local app = hs.application.launchOrFocus("MyApp")
hs.timer.usleep(2000000)  -- Wait 2 seconds

-- 2. Verify app launched
assert(hs.application.get("MyApp"), "FAIL: App did not launch")

-- 3. Simulate user input
hs.eventtap.keyStroke({"cmd"}, "n")  -- New document
hs.timer.usleep(500000)
hs.eventtap.keyStrokes("Test content")

-- 4. Save
hs.eventtap.keyStroke({"cmd"}, "s")
hs.timer.usleep(1000000)

-- 5. Take screenshot for verification
local win = hs.window.focusedWindow()
local img = win:snapshot()
img:saveToFile("/tmp/test_result.png")

-- 6. Verify expected state
local title = win:title()
assert(title:find("Test"), "FAIL: Document not saved correctly")

print("PASS: Workflow completed successfully")
```

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

### C/Meson Projects

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

See `dev-explore` for full ast-grep and ripgrep-all (rga) reference.

## Integration

This skill is used by **Task agents** during implementation.

For TDD protocol (RED-GREEN-REFACTOR), see:
```
Skill(skill="workflows:dev-tdd")
```
