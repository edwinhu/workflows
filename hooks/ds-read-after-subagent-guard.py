#!/usr/bin/env -S uv run python3
"""PreToolUse guard: block Read/Grep on non-.planning/ files after subagent return.

Checks the flag file set by ds-post-subagent-guard.py. If set, blocks
Read/Grep on paths that are NOT under .planning/.
"""
import json
import os
import sys
import tempfile

def main():
    tool_input = json.loads(sys.stdin.read())
    tool_name = tool_input.get("tool_name", "")
    tool_params = tool_input.get("tool_input", {})

    # Check if subagent has returned
    flag_dir = os.path.join(tempfile.gettempdir(), "ds-workflow-flags")
    session_id = os.environ.get("CLAUDE_SESSION_ID", "default")
    flag_file = os.path.join(flag_dir, f"subagent-returned-{session_id}")

    if not os.path.exists(flag_file):
        # No subagent has returned yet — allow everything
        print(json.dumps({"decision": "allow"}))
        return

    # Subagent has returned — check if this is a read on non-state files
    path = ""
    if tool_name == "Read":
        path = tool_params.get("file_path", "")
    elif tool_name == "Grep":
        path = tool_params.get("path", "")
    elif tool_name == "Glob":
        path = tool_params.get("path", "")

    if not path:
        print(json.dumps({"decision": "allow"}))
        return

    # Allow reads of state files (.planning/), plugin files, and common config
    allowed_patterns = [".planning/", ".claude/", "CLAUDE.md", "plugins/cache/"]
    if any(pattern in path for pattern in allowed_patterns):
        print(json.dumps({"decision": "allow"}))
        return

    # Block reads of source/data files after subagent return
    print(json.dumps({
        "decision": "block",
        "message": "\ud83d\uded1 Post-subagent boundary (C5): After a subagent returns, main chat must NOT read source/data files. Verify via .planning/ state files only. If you need to investigate further, dispatch a NEW subagent."
    }))

if __name__ == "__main__":
    main()
