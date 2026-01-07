---
name: dev-test-linux
description: "Linux E2E testing with ydotool (Wayland), xdotool (X11), grim, and D-Bus."
---

**Announce:** "I'm using dev-test-linux for Linux desktop automation."

## Contents

- [Tool Availability Gate](#tool-availability-gate)
- [Detect Display Server](#detect-display-server)
- [Wayland: ydotool](#wayland-ydotool)
- [X11: xdotool](#x11-xdotool)
- [Screenshots](#screenshots)
- [D-Bus Control](#d-bus-control)
- [Accessibility (AT-SPI)](#accessibility-at-spi)
- [Complete E2E Examples](#complete-e2e-examples)

# Linux Desktop Automation

<EXTREMELY-IMPORTANT>
## Tool Availability Gate

**Verify automation tools are installed before proceeding.**

```bash
# Detect display server
echo $XDG_SESSION_TYPE  # "wayland" or "x11"

# Wayland tools
which ydotool || echo "MISSING: ydotool"
which wtype || echo "MISSING: wtype"
which grim || echo "MISSING: grim"
which slurp || echo "MISSING: slurp"

# X11 tools
which xdotool || echo "MISSING: xdotool"
which xclip || echo "MISSING: xclip"
which scrot || echo "MISSING: scrot"

# D-Bus
which dbus-send || echo "MISSING: dbus-send"
```

**If missing (Wayland):**
```
STOP: Cannot proceed with Wayland automation.

Missing tools for Wayland E2E testing.

Install with:
  # Arch
  sudo pacman -S ydotool wtype grim slurp

  # Debian/Ubuntu
  sudo apt install ydotool wtype grim slurp

  # Nix
  nix-env -iA nixpkgs.ydotool nixpkgs.wtype nixpkgs.grim nixpkgs.slurp

Start ydotool daemon:
  sudo systemctl enable --now ydotool
  # Or for user service:
  systemctl --user enable --now ydotool

Reply when installed and I'll continue testing.
```

**This gate is non-negotiable. Missing tools = full stop.**
</EXTREMELY-IMPORTANT>

## Detect Display Server

```bash
# Check display server type
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "Using Wayland tools (ydotool, wtype, grim)"
else
    echo "Using X11 tools (xdotool, xclip, scrot)"
fi
```

## Wayland: ydotool

**Requires ydotoold daemon running.**

### Keyboard Input

```bash
# Type text
ydotool type "hello world"

# Type with delay between keys (microseconds)
ydotool type --delay 50 "slow typing"

# Key press (using keycodes)
# Format: keycode:state (1=down, 0=up)
ydotool key 28:1 28:0           # Enter
ydotool key 1:1 1:0             # Escape
ydotool key 29:1 46:1 46:0 29:0 # Ctrl+C (29=Ctrl, 46=C)
ydotool key 29:1 47:1 47:0 29:0 # Ctrl+V (47=V)
ydotool key 56:1 15:1 15:0 56:0 # Alt+Tab

# Common keycodes:
# 1=Escape, 14=Backspace, 15=Tab, 28=Enter, 29=Ctrl, 42=LShift
# 56=Alt, 57=Space, 100=RightAlt, 125=Super/Win
```

### Alternative: wtype (Wayland-native)

```bash
# Type text
wtype "hello world"

# Key press with modifiers
wtype -M ctrl -k c  # Ctrl+C
wtype -M ctrl -M shift -k s  # Ctrl+Shift+S
wtype -k Return     # Enter
wtype -k Escape     # Escape

# Modifier keys: -M (press and hold)
# Available: shift, ctrl, alt, logo (super)
```

### Mouse Input

```bash
# Move mouse to absolute position
ydotool mousemove --absolute 100 200

# Relative move
ydotool mousemove 50 -30

# Click (button: 1=left, 2=middle, 3=right)
ydotool click 1        # Left click
ydotool click 3        # Right click

# Double click
ydotool click 1 1

# Click at specific position
ydotool mousemove --absolute 500 300 && ydotool click 1

# Drag
ydotool mousemove --absolute 100 100
ydotool mousedown 1
ydotool mousemove --absolute 200 200
ydotool mouseup 1
```

## X11: xdotool

### Keyboard Input

```bash
# Type text
xdotool type "hello world"

# Key press
xdotool key Return
xdotool key Escape
xdotool key ctrl+c
xdotool key ctrl+shift+s
xdotool key alt+Tab
xdotool key super+d

# Key with delay
xdotool type --delay 50 "slow typing"

# Hold key
xdotool keydown ctrl
xdotool key c
xdotool keyup ctrl
```

### Mouse Input

```bash
# Move mouse
xdotool mousemove 100 200           # Absolute
xdotool mousemove --relative 50 30  # Relative

# Click
xdotool click 1   # Left
xdotool click 2   # Middle
xdotool click 3   # Right

# Double click
xdotool click --repeat 2 1

# Click at position
xdotool mousemove 500 300 click 1

# Drag
xdotool mousemove 100 100 mousedown 1 mousemove 200 200 mouseup 1
```

### Window Control (X11)

```bash
# Get active window ID
xdotool getactivewindow

# Focus window by name
xdotool search --name "Firefox" windowactivate

# Focus window by class
xdotool search --class "firefox" windowactivate

# Get window title
xdotool getactivewindow getwindowname

# Move window
xdotool getactivewindow windowmove 100 100

# Resize window
xdotool getactivewindow windowsize 800 600

# Minimize/Maximize
xdotool getactivewindow windowminimize
xdotool search --name "Firefox" windowactivate --sync
```

## Screenshots

### Wayland: grim + slurp

```bash
# Full screen (all outputs)
grim /tmp/screenshot.png

# Specific output
grim -o DP-1 /tmp/screen.png

# Interactive region selection
grim -g "$(slurp)" /tmp/region.png

# Specific region (x,y width x height)
grim -g "100,200 800x600" /tmp/region.png

# Specific window (Hyprland)
# Get window geometry first
hyprctl clients -j | jq '.[] | select(.class=="firefox")'
grim -g "X,Y WxH" /tmp/window.png

# Sway: get focused window
grim -g "$(swaymsg -t get_tree | jq -r '.. | select(.focused?) | .rect | "\(.x),\(.y) \(.width)x\(.height)"')" /tmp/window.png
```

### X11: scrot / import

```bash
# Full screen
scrot /tmp/screenshot.png

# Active window
scrot -u /tmp/window.png

# Interactive selection
scrot -s /tmp/selection.png

# Delay (seconds)
scrot -d 3 /tmp/delayed.png

# Using ImageMagick import
import -window root /tmp/screenshot.png
import -window "$(xdotool getactivewindow)" /tmp/window.png
```

### Image Comparison

```bash
# Compare screenshots (ImageMagick)
compare -metric AE baseline.png current.png diff.png
# Returns number of different pixels

# Threshold comparison
compare -metric AE -fuzz 5% baseline.png current.png diff.png
```

## D-Bus Control

**Preferred for apps that expose D-Bus interfaces.**

```bash
# List available services
dbus-send --session --print-reply --dest=org.freedesktop.DBus \
  /org/freedesktop/DBus org.freedesktop.DBus.ListNames

# Example: Zathura PDF viewer
# Get PID first, then use org.pwmt.zathura.PID-XXXX
dbus-send --print-reply --dest=org.pwmt.zathura.PID-12345 \
  /org/pwmt/zathura org.pwmt.zathura.OpenDocument string:"/path/to/file.pdf"

dbus-send --print-reply --dest=org.pwmt.zathura.PID-12345 \
  /org/pwmt/zathura org.pwmt.zathura.GotoPage uint32:5

# Example: GNOME apps via freedesktop.Application
dbus-send --session --dest=org.gnome.Nautilus \
  /org/gnome/Nautilus org.freedesktop.Application.Open \
  array:string:"file:///home/user" dict:string:string:""

# Introspect available methods
dbus-send --session --print-reply --dest=org.example.App \
  /org/example/App org.freedesktop.DBus.Introspectable.Introspect
```

## Accessibility (AT-SPI)

**For UI element discovery and verification.**

```python
#!/usr/bin/env python3
import pyatspi

# Find application
desktop = pyatspi.Registry.getDesktop(0)
for app in desktop:
    if "firefox" in app.name.lower():
        print(f"Found: {app.name}")

        # Traverse accessibility tree
        def dump_tree(node, indent=0):
            print("  " * indent + f"{node.getRole()}: {node.name}")
            for child in node:
                dump_tree(child, indent + 1)

        dump_tree(app)

# Find specific element
def find_button(app, name):
    for child in app:
        if child.getRole() == pyatspi.ROLE_PUSH_BUTTON:
            if name.lower() in child.name.lower():
                return child
        found = find_button(child, name)
        if found:
            return found
    return None

button = find_button(app, "Submit")
if button:
    # Click via AT-SPI
    button.queryAction().doAction(0)
```

## Complete E2E Examples

### Wayland E2E Test

```bash
#!/bin/bash
# test_workflow.sh - Wayland E2E test

set -e  # Exit on error

echo "Starting E2E test..."

# 1. Launch app
firefox &
sleep 3

# 2. Navigate to URL
wtype -M ctrl -k l  # Focus address bar
sleep 0.2
wtype "https://example.com"
wtype -k Return
sleep 2

# 3. Take screenshot
grim /tmp/test_before.png

# 4. Interact with page
ydotool mousemove --absolute 500 400
ydotool click 1
sleep 0.5

# 5. Take final screenshot
grim /tmp/test_after.png

# 6. Compare (simple size check)
SIZE_BEFORE=$(stat -c%s /tmp/test_before.png)
SIZE_AFTER=$(stat -c%s /tmp/test_after.png)

if [ "$SIZE_BEFORE" -ne "$SIZE_AFTER" ]; then
    echo "PASS: Screenshots differ (interaction worked)"
else
    echo "WARN: Screenshots identical"
fi

echo "Test complete"
```

### X11 E2E Test

```bash
#!/bin/bash
# test_workflow_x11.sh - X11 E2E test

set -e

echo "Starting X11 E2E test..."

# 1. Launch app
gedit &
sleep 2

# 2. Focus window
xdotool search --name "gedit" windowactivate --sync

# 3. Type content
xdotool type "Hello, this is an automated test!"
sleep 0.5

# 4. Select all and copy
xdotool key ctrl+a
xdotool key ctrl+c

# 5. Verify clipboard
CLIPBOARD=$(xclip -selection clipboard -o)
if [[ "$CLIPBOARD" == *"automated test"* ]]; then
    echo "PASS: Clipboard contains expected text"
else
    echo "FAIL: Clipboard mismatch"
    exit 1
fi

# 6. Screenshot
scrot -u /tmp/test_result.png
echo "Screenshot saved"

# 7. Close without saving
xdotool key ctrl+w
sleep 0.5
xdotool key Tab key Return  # Don't save

echo "Test complete"
```

## Integration

This skill is referenced by `dev-test` for Linux-specific automation.

For TDD protocol, see: `Skill(skill="workflows:dev-tdd")`
