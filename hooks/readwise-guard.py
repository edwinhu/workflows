#!/usr/bin/env python3
"""
PreToolUse hook: Block Readwise MCP calls from main chat.

Main chat MUST delegate Readwise operations to librarian sub-agent.
Librarian creates a flag file to authorize its own calls.

Flag file: /tmp/claude-readwise-librarian-authorized
"""

import json
import os
import sys

FLAG_FILE = "/tmp/claude-readwise-librarian-authorized"


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')

    # Only check Readwise MCP tools
    if not tool_name.startswith('mcp__readwise__'):
        sys.exit(0)

    # Check for librarian authorization flag
    if os.path.exists(FLAG_FILE):
        # Librarian authorized, allow
        sys.exit(0)

    # No authorization - block and redirect to librarian
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "IRON LAW VIOLATION: Main chat cannot call Readwise tools directly.\n\n"
                "Readwise operations MUST go through the librarian sub-agent:\n\n"
                "```\n"
                'Task(subagent_type="workflows:librarian", prompt="Search Readwise for [topic]")\n'
                "```\n\n"
                "**Why?**\n"
                "- Readwise MCP returns verbose results that waste context\n"
                "- Librarian knows the full workflow: NLM first → Reader API for tags → MCP for semantic\n"
                "- Librarian formats results properly for NotebookLM\n\n"
                "**If user mentioned tagged items:** Use Reader API script via librarian:\n"
                '`python3 skills/readwise/scripts/readwise_to_nlm.py --tag "tag" --notebook <id>`'
            )
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
