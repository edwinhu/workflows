#!/usr/bin/env python3
"""PreToolUse guard: block Write/Edit during review phases.

Review agents should be read-only. This hook blocks Write and Edit
tool calls to prevent reviewers from "fixing" issues they find.
"""
import json
import sys

def main():
    tool_input = json.loads(sys.stdin.read())
    tool_name = tool_input.get("tool_name", "")

    if tool_name in ("Write", "Edit"):
        print(json.dumps({
            "decision": "block",
            "message": "\ud83d\uded1 Reviewer read-only enforcement: Review/verification agents must NOT modify files. Report findings back to the orchestrator for planned fixes."
        }))
    else:
        print(json.dumps({"decision": "allow"}))

if __name__ == "__main__":
    main()
