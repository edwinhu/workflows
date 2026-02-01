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

    # Debug: write hook input to file to see what's available
    import os
    debug_file = "/tmp/readwise-hook-debug.json"
    with open(debug_file, "w") as f:
        json.dump(hook_input, f, indent=2, default=str)

    tool_name = hook_input.get("tool_name", "")

    # Check if this is a sub-agent by looking at transcript context
    # Sub-agents typically have a different session structure
    transcript = hook_input.get("transcript", [])

    # If transcript has Task tool calls spawning this agent, allow it
    # For now, just allow all - we'll refine after seeing debug output
    sys.exit(0)  # TEMPORARILY ALLOW ALL

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
