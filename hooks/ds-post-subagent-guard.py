#!/usr/bin/env -S uv run python3
"""PostToolUse guard: after Agent/Task returns, block Read/Grep on non-state files.

Sets a flag file when a subagent completes. A PreToolUse hook then checks
this flag and blocks Read/Grep on non-.planning/ paths.

This is a simplified version — the flag is set per-session via an env-based temp file.
"""
import json
import os
import sys
import tempfile

def main():
    # Read the tool use from stdin
    tool_input = json.loads(sys.stdin.read())
    tool_name = tool_input.get("tool_name", "")

    # This hook fires PostToolUse on Agent/Task
    # Set a flag file indicating subagent has returned
    flag_dir = os.path.join(tempfile.gettempdir(), "ds-workflow-flags")
    os.makedirs(flag_dir, exist_ok=True)

    session_id = os.environ.get("CLAUDE_SESSION_ID", "default")
    flag_file = os.path.join(flag_dir, f"subagent-returned-{session_id}")

    with open(flag_file, "w") as f:
        f.write("1")

    # Allow the tool use to proceed
    print(json.dumps({"decision": "allow"}))

if __name__ == "__main__":
    main()
