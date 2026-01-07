---
name: dev-test-macos
description: macOS E2E testing with Hammerspoon, screencapture, and cliclick.
---
## Contents

- [Tool Availability Gate](#tool-availability-gate)
- [Hammerspoon Setup](#hammerspoon-setup)
- [Input Simulation](#input-simulation)
- [Application Control](#application-control)
- [Window Management](#window-management)
- [Screenshots](#screenshots)
- [Complete E2E Example](#complete-e2e-example)
- [Alternative: cliclick](#alternative-cliclick)

# macOS Desktop Automation

<EXTREMELY-IMPORTANT>
## Tool Availability Gate

**Verify Hammerspoon is installed before proceeding.**

```bash
# Check Hammerspoon
which hs || echo "MISSING: hs CLI"
ls /Applications/Hammerspoon.app 2>/dev/null || echo "MISSING: Hammerspoon.app"
```

**If missing:**
```
STOP: Cannot proceed with macOS automation.

Missing tool: Hammerspoon (required for macOS E2E testing)

Install with:
  brew install --cask hammerspoon

After installing:
  1. Open Hammerspoon.app
  2. Grant Accessibility permissions in System Preferences
  3. In Hammerspoon console, run: hs.ipc.cliInstall()
  4. Add to ~/.hammerspoon/init.lua: require("hs.ipc")

Reply when installed and I'll continue testing.
```

**This gate is non-negotiable. Missing tools = full stop.**
</EXTREMELY-IMPORTANT>

## Hammerspoon Setup

**One-time setup in `~/.hammerspoon/init.lua`:**
```lua
require("hs.ipc")  -- Enables CLI
```

**Reload config after changes:**
```bash
hs -c 'hs.reload()'
```

## Input Simulation

### hs.eventtap - Keyboard/Mouse

```lua
-- Type text (simulates keystrokes)
hs.eventtap.keyStrokes("hello world")

-- Key press with modifiers
hs.eventtap.keyStroke({"cmd"}, "c")           -- Cmd+C
hs.eventtap.keyStroke({"cmd", "shift"}, "s")  -- Cmd+Shift+S
hs.eventtap.keyStroke({"ctrl", "alt"}, "t")   -- Ctrl+Alt+T
hs.eventtap.keyStroke({}, "return")           -- Enter key
hs.eventtap.keyStroke({}, "escape")           -- Escape key

-- Function keys
hs.eventtap.keyStroke({}, "f1")
hs.eventtap.keyStroke({"cmd"}, "f5")

-- Mouse clicks
hs.eventtap.leftClick({x=100, y=200})
hs.eventtap.rightClick({x=100, y=200})
hs.eventtap.middleClick({x=100, y=200})
hs.eventtap.doubleClick({x=100, y=200})

-- Mouse movement
hs.mouse.absolutePosition({x=500, y=300})

-- Scroll
hs.eventtap.scrollWheel({0, -5}, {})  -- Scroll down
hs.eventtap.scrollWheel({0, 5}, {})   -- Scroll up
```

### Running from CLI

```bash
# Execute Lua code directly
hs -c 'hs.eventtap.keyStroke({"cmd"}, "c")'

# Execute a script file
hs /path/to/test_script.lua

# Pipe script via stdin
echo 'hs.eventtap.keyStrokes("test")' | hs -s
```

## Application Control

### hs.application

```lua
-- Launch or focus app by name
local app = hs.application.launchOrFocus("Safari")

-- Launch app by bundle ID
hs.application.launchOrFocusByBundleID("com.apple.Safari")

-- Get running app
local app = hs.application.get("Safari")
if app then
    app:activate()       -- Bring to front
    app:hide()           -- Hide
    app:unhide()         -- Unhide
    app:kill()           -- Terminate gracefully
    app:kill9()          -- Force kill
end

-- Get frontmost app
local front = hs.application.frontmostApplication()
print(front:name())
print(front:bundleID())

-- List all running apps
for _, app in ipairs(hs.application.runningApplications()) do
    print(app:name())
end

-- Wait for app to launch
hs.timer.waitUntil(
    function() return hs.application.get("MyApp") ~= nil end,
    function() print("App launched") end,
    0.5  -- Check every 0.5 seconds
)
```

### Menu Items

```lua
-- Click menu item
local app = hs.application.get("Safari")
app:selectMenuItem({"File", "New Window"})
app:selectMenuItem({"Edit", "Paste"})

-- Check if menu item exists
local menuItem = app:findMenuItem({"File", "Save"})
if menuItem then
    print("Save is available, enabled:", menuItem.enabled)
end
```

## Window Management

### hs.window

```lua
-- Get focused window
local win = hs.window.focusedWindow()
print(win:title())
print(win:frame())  -- {x, y, w, h}

-- Get app's windows
local app = hs.application.get("Safari")
local wins = app:allWindows()
for _, win in ipairs(wins) do
    print(win:title())
end

-- Get window by title (partial match)
local win = hs.window.get("My Document")

-- Window actions
win:focus()           -- Focus window
win:maximize()        -- Maximize
win:minimize()        -- Minimize to dock
win:close()           -- Close window

-- Move/resize
win:setFrame({x=100, y=100, w=800, h=600})
win:move({100, 0})    -- Move relative
win:setSize({800, 600})
win:centerOnScreen()

-- Get window position and size
local frame = win:frame()
print("Position:", frame.x, frame.y)
print("Size:", frame.w, frame.h)
```

## Screenshots

### screencapture (CLI)

```bash
# Full screen (all displays)
screencapture /tmp/screenshot.png

# Main screen only
screencapture -m /tmp/main_screen.png

# Specific window (interactive - click to select)
screencapture -w /tmp/window.png

# Specific region
screencapture -R 100,200,800,600 /tmp/region.png

# Without window shadow
screencapture -o /tmp/no_shadow.png

# Silent (no camera sound)
screencapture -x /tmp/silent.png

# To clipboard instead of file
screencapture -c

# Combined: silent, no shadow, specific region
screencapture -x -o -R 0,0,1920,1080 /tmp/clean.png
```

### hs.screen (Hammerspoon)

```lua
-- Capture focused window
local win = hs.window.focusedWindow()
if win then
    local img = win:snapshot()
    img:saveToFile("/tmp/window.png")
end

-- Capture entire screen
local screen = hs.screen.mainScreen()
local img = screen:snapshot()
img:saveToFile("/tmp/screen.png")

-- Capture specific region
local img = hs.screen.mainScreen():snapshot({x=0, y=0, w=800, h=600})
img:saveToFile("/tmp/region.png")
```

## Complete E2E Example

```lua
-- test_workflow.lua
-- Run with: hs /path/to/test_workflow.lua

local function test_app_workflow()
    -- 1. Launch app
    print("Launching app...")
    hs.application.launchOrFocus("TextEdit")
    hs.timer.usleep(1000000)  -- Wait 1 second

    -- 2. Verify app launched
    local app = hs.application.get("TextEdit")
    assert(app, "FAIL: TextEdit did not launch")
    print("App launched: " .. app:name())

    -- 3. Create new document
    hs.eventtap.keyStroke({"cmd"}, "n")
    hs.timer.usleep(500000)

    -- 4. Type content
    hs.eventtap.keyStrokes("Hello, this is an automated test!")
    hs.timer.usleep(300000)

    -- 5. Select all and copy
    hs.eventtap.keyStroke({"cmd"}, "a")
    hs.timer.usleep(100000)
    hs.eventtap.keyStroke({"cmd"}, "c")

    -- 6. Verify clipboard
    local clipboard = hs.pasteboard.getContents()
    assert(clipboard:find("automated test"), "FAIL: Clipboard doesn't match")
    print("Clipboard verified: " .. clipboard)

    -- 7. Take screenshot
    local win = hs.window.focusedWindow()
    local img = win:snapshot()
    img:saveToFile("/tmp/test_result.png")
    print("Screenshot saved to /tmp/test_result.png")

    -- 8. Close without saving
    hs.eventtap.keyStroke({"cmd"}, "w")
    hs.timer.usleep(500000)
    hs.eventtap.keyStroke({}, "d")  -- "Don't Save" button

    print("PASS: Workflow completed successfully")
end

-- Run the test
local status, err = pcall(test_app_workflow)
if not status then
    print("FAIL: " .. tostring(err))
    os.exit(1)
end
os.exit(0)
```

**Run from CLI:**
```bash
hs /path/to/test_workflow.lua && echo "TEST PASSED" || echo "TEST FAILED"
```

## Alternative: cliclick

For simpler needs, `cliclick` provides CLI-based mouse/keyboard control:

```bash
# Install
brew install cliclick

# Mouse click at coordinates
cliclick c:100,200       # Left click
cliclick rc:100,200      # Right click
cliclick dc:100,200      # Double click

# Move mouse
cliclick m:500,300

# Type text
cliclick t:"Hello world"

# Key press
cliclick kp:return
cliclick kp:escape
cliclick kd:cmd kp:c ku:cmd  # Cmd+C

# Wait (milliseconds)
cliclick w:500
```

**cliclick is useful for simple scripts but lacks app control - prefer Hammerspoon for complex E2E tests.**

## Integration

This skill is referenced by `dev-test` for macOS-specific automation.

For TDD protocol, see: `Skill(skill="workflows:dev-tdd")`