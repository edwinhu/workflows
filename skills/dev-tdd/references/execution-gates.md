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

## Red Flags - STOP Immediately

If you catch yourself thinking ANY of these, STOP—you're about to skip a gate:

| Thought | Why It's Wrong | Action |
|---------|----------------|--------|
| "Build succeeded, let me screenshot" | You skipped GATES 2-6 | Go to GATE 2 |
| "Let me take a screenshot" | You skipped GATES 1-6 | Start at GATE 1 |
| "Process is running, let me test" | You skipped GATES 5-6 (READ LOGS) | Go to GATE 5 |
| "I'll check logs if test fails" | Backward—logs come BEFORE tests | Go to GATE 5 |
| "Sleep is enough" | Sleep ≠ verification | Do GATES 4-6 |

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Build passed, app must work" | NO. GATES 2-6 required. Do them now. |
| "I can see the window" | NO. You haven't READ LOGS (GATE 5). Do it now. |
| "I'll check logs later" | NO. GATE 5 comes BEFORE E2E. Do it now. |
| "Logs are optional" | NO. GATE 5 is MANDATORY. Cannot skip. |
| "Screenshots will show issues" | NO. Screenshots can't show log errors. GATE 5 first. |

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

## Rationalization Prevention (Screenshots)

| Excuse | Reality |
|--------|---------|
| "Whole screen is easier" | Easier = wrong conclusions. Window only. |
| "I can tell which app it is" | You make mistakes. Isolate the window. |
| "Other apps don't matter" | They confuse verification. Window only. |
| "grim /tmp/screenshot.png works" | That's whole screen. Use `-g` with geometry. |
| "scrot is enough" | That's whole screen. Use `scrot -u` for active window. |

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

## Rationalization Prevention (Feature Cropping)

| Excuse | Reality |
|--------|---------|
| "Whole window shows context" | Context confuses verification. Crop to feature. |
| "I can see the feature in the full screenshot" | You read wrong elements. Isolate the feature. |
| "Cropping is too much work" | 5 extra seconds prevents false conclusions. |
| "The whole window is relevant" | Only test what you changed. Crop to feature. |
| "I'll just focus on the right area" | You make mistakes. Force isolation via crop. |

**Tool description:** Crop screenshot to specific feature region being tested
</EXTREMELY-IMPORTANT>

## The Honesty Requirement

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
