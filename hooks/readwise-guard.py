#!/usr/bin/env python3
"""
PreToolUse hook: Block direct use of Readwise MCP in main chat.

Readwise operations must be delegated to the librarian sub-agent to:
1. Avoid context pollution from verbose search results
2. Use the correct tool (Reader API vs MCP semantic search)
3. Enable full workflow (search -> format -> add to NotebookLM)
"""

import json
import sys


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")

    # Only block in main chat, not in sub-agents
    # Sub-agents have session_id in their context
    session_context = hook_input.get("session_context", {})
    is_subagent = session_context.get("is_subagent", False)

    if is_subagent:
        sys.exit(0)

    # Block Readwise MCP tools in main chat
    if not tool_name.startswith("mcp__readwise__"):
        sys.exit(0)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "BLOCKED: No Readwise MCP tools in main chat.\n\n"
                "Delegate to librarian sub-agent instead:\n\n"
                "```\n"
                'Task(subagent_type="workflows:librarian", prompt="Search Readwise for...")\n'
                "```\n\n"
                "Why:\n"
                "- Search results are verbose, waste main context tokens\n"
                "- Librarian knows full workflow (search -> format -> NotebookLM)\n"
                "- Reader API (in librarian) has tag filtering; MCP is semantic-only"
            )
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
