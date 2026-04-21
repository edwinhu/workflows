#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Block exploration until spec review is complete.

Denies Grep/Glob/Agent tool calls in dev-explore if .planning/SPEC.md
does not exist. This ensures Phase 1 (brainstorm + spec review)
completed before Phase 2 (explore) begins.

Note: Currently checks for SPEC.md existence only. When dev-spec-reviewer
is updated to produce .planning/SPEC_REVIEWED.md (like the plan reviewer
pattern), this hook should check for that marker instead.
"""

import json
import os
import sys
from pathlib import Path


def check_spec_exists(cwd: str) -> tuple[bool, str]:
    """Check if .planning/SPEC.md exists (spec was written and reviewed)."""
    spec_file = Path(cwd) / '.planning' / 'SPEC.md'

    if not spec_file.exists():
        return False, (
            "SPEC GATE: .planning/SPEC.md does not exist.\n\n"
            "Cannot explore the codebase without a finalized spec.\n"
            "Phase 1 (brainstorm) must complete and produce SPEC.md first.\n\n"
            "Return to dev-brainstorm to write and review the spec."
        )

    # Future: check for .planning/SPEC_REVIEWED.md marker
    # spec_reviewed = Path(cwd) / '.planning' / 'SPEC_REVIEWED.md'
    # if not spec_reviewed.exists():
    #     return False, "SPEC REVIEW GATE: Spec has not been independently reviewed."

    return True, ""


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')

    # Gate exploration tools — Grep/Glob/Agent are the exploration workhorses
    if tool_name not in ('Grep', 'Glob', 'Agent'):
        sys.exit(0)

    cwd = hook_input.get('cwd', os.getcwd())

    exists, reason = check_spec_exists(cwd)
    if exists:
        sys.exit(0)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
