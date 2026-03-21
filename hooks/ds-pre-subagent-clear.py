#!/usr/bin/env python3
"""PreToolUse guard: clear post-subagent flag before dispatching a new subagent.

When a new Agent/Task is about to be dispatched, clear the flag file so that
reads needed to prepare the subagent prompt are not blocked.
"""
import json
import os
import sys
import tempfile


def main():
    # Clear the flag file — new subagent dispatch means reads are allowed again
    flag_dir = os.path.join(tempfile.gettempdir(), "ds-workflow-flags")
    session_id = os.environ.get("CLAUDE_SESSION_ID", "default")
    flag_file = os.path.join(flag_dir, f"subagent-returned-{session_id}")

    if os.path.exists(flag_file):
        os.remove(flag_file)

    print(json.dumps({"decision": "allow"}))


if __name__ == "__main__":
    main()
