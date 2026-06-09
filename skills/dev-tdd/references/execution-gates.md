# The Execution Gate (MANDATORY)

<EXTREMELY-IMPORTANT>
**NO E2E TESTS WITHOUT PASSING THE EXECUTION GATE FIRST. This is absolute.**

## The Gate Sequence

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
</EXTREMELY-IMPORTANT>

## Red Flags - STOP Immediately

- About to screenshot or run E2E tests without having passed GATES 1-4 → start at GATE 1.
- About to test with the process running but logs unread → GATE 5 first. Logs come BEFORE tests, not after failures — screenshots cannot show log errors.

## For GUI Applications (Mandatory Pattern)

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

## The Iron Law of GUI E2E Testing

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
</EXTREMELY-IMPORTANT>

## Screenshot Facts

- Bare `grim /tmp/screenshot.png` and bare `scrot` capture the WHOLE screen — other apps' "Success" messages, icons, and panels leak into the frame. Window-only capture requires `grim -g "$GEOMETRY"` (Wayland) or `scrot -u` (X11). A verdict read off a whole-screen shot is evidence you could not isolate — an unverified claim presented as verification.

## Platform-Specific Window Screenshots

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

## Feature-Specific Screenshot Cropping

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

**Tool description:** Crop screenshot to specific feature region being tested
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
When you say "E2E test passed", you are asserting:
- You passed GATE 1 (built successfully)
- You passed GATE 2 (launched with logging)
- You passed GATE 3 (waited for init)
- You passed GATE 4 (process is running)
- **You passed GATE 5 (READ the full log file)**
- **You passed GATE 6 (VERIFIED no errors in logs)**
- You ran E2E tests with clean logs

Saying "E2E passed" without completing GATES 5-6 is not "testing" — it is creating false confidence that wastes the user's time when the bug surfaces.

**"Checking logs now" protects the user. "E2E verified" without GATE 5 ships hidden bugs.**
</EXTREMELY-IMPORTANT>
