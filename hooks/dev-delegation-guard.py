#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Enforce delegation — deny Write/Edit on project code files.

The Iron Law of Delegation: main chat orchestrates, subagents implement.
Main chat may only Write/Edit workflow state files (.planning/, .claude/).
All other file writes must be delegated to subagents.

Scoped to dev and dev-debug skills (top-level only).
Grounded in: March 16, 2026 incident — 71 protocol violations when main chat
"verified" subagent work by reading/editing source code directly.
"""

import json
import sys
from pathlib import Path


ALLOWED_DIRS = {'.planning', '.claude'}


def is_allowed_path(file_path: str) -> bool:
    """Check if the file path is in an allowed directory."""
    parts = Path(file_path).parts
    return any(d in parts for d in ALLOWED_DIRS)


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name not in ('Write', 'Edit'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    if is_allowed_path(file_path):
        sys.exit(0)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "DELEGATION VIOLATION: Main chat cannot Write/Edit project files.\n\n"
                f"Attempted: {tool_name} on `{file_path}`\n\n"
                "The Iron Law of Delegation: main chat orchestrates, subagents implement.\n"
                "Spawn a Task agent to make this change instead.\n\n"
                "Allowed in main chat: .planning/* and .claude/* only."
            )
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
