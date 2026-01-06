#!/usr/bin/env python3
"""
Minimal PreToolUse hook: Only enforces sandbox when dev_mode is active.
Exits immediately if dev_mode marker doesn't exist (zero overhead).
"""

from __future__ import annotations

import json
import sys
import os
import re
from pathlib import Path
from typing import Optional

# Find session directory
def get_session_dir():
    pattern = f"/tmp/claude-workflow-{os.getppid()}"
    if os.path.isdir(pattern):
        return Path(pattern)
    # Try glob for any matching dir
    import glob
    dirs = glob.glob("/tmp/claude-workflow-*")
    return Path(dirs[0]) if dirs else None

# Early exit if dev_mode not active
session_dir = get_session_dir()
if not session_dir or not (session_dir / "dev_mode").exists():
    # No sandbox active - allow everything
    sys.exit(0)

# Sandbox is active - enforce restrictions
try:
    input_data = json.loads(sys.stdin.read())
except:
    sys.exit(0)

tool_name = input_data.get("tool_name", "")
tool_input = input_data.get("tool_input", {})

# Sandbox rules for dev mode
BLOCKED_PATTERNS = [
    r"rm\s+-rf\s+/",
    r"sudo\s+rm",
    r">\s*/dev/sd",
    r"mkfs\.",
    r"dd\s+if=.+of=/dev",
]

PROTECTED_PATHS = [
    "/etc/", "/usr/", "/bin/", "/sbin/",
    os.path.expanduser("~/.ssh/"),
    os.path.expanduser("~/.gnupg/"),
]

def check_bash(command: str) -> Optional[str]:
    """Check bash command for dangerous patterns."""
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE):
            return f"Blocked: dangerous command pattern"
    return None

def check_file_write(file_path: str) -> Optional[str]:
    """Check if file write is to a protected path."""
    abs_path = os.path.abspath(os.path.expanduser(file_path))
    for protected in PROTECTED_PATHS:
        if abs_path.startswith(protected):
            return f"Blocked: cannot write to protected path {protected}"
    return None

# Apply checks based on tool
error = None

if tool_name == "Bash":
    command = tool_input.get("command", "")
    error = check_bash(command)

elif tool_name in ("Write", "Edit"):
    file_path = tool_input.get("file_path", "")
    error = check_file_write(file_path)

# Output result
if error:
    print(json.dumps({
        "decision": "block",
        "reason": error
    }))
    sys.exit(0)

# Allow the operation
sys.exit(0)
