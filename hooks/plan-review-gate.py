#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Block implementation until plan review is complete.

Denies Agent tool calls in dev-implement if .planning/PLAN_REVIEWED.md
does not exist or does not contain 'status: APPROVED'.

This is structural enforcement — the runtime blocks the tool call,
not just instructions that can be rationalized away.

Grounded in: superhuman-cli incident (March 2026) where plan reviewer
was skipped entirely, causing spec requirements CT-02/CT-03 to be
silently dropped from implementation.
"""

import json
import os
import sys
from pathlib import Path


def check_plan_reviewed(cwd: str) -> tuple[bool, str]:
    """Check if .planning/PLAN_REVIEWED.md exists with APPROVED status."""
    plan_reviewed = Path(cwd) / '.planning' / 'PLAN_REVIEWED.md'

    if not plan_reviewed.exists():
        return False, (
            "PLAN REVIEW GATE: .planning/PLAN_REVIEWED.md does not exist.\n\n"
            "The plan reviewer has NOT been run. This means:\n"
            "- Spec requirements may have been silently dropped from the plan\n"
            "- Task decomposition has not been independently verified\n\n"
            "Return to dev-design Phase Complete and run the plan reviewer.\n"
            "The reviewer writes PLAN_REVIEWED.md on approval.\n\n"
            "This gate exists because the superhuman-cli incident proved that\n"
            "skipping plan review causes spec requirements to be lost."
        )

    try:
        content = plan_reviewed.read_text()
        if 'status: APPROVED' not in content:
            return False, (
                "PLAN REVIEW GATE: .planning/PLAN_REVIEWED.md exists but status is not APPROVED.\n\n"
                "The plan review is incomplete or found issues.\n"
                "Fix the issues and re-run the plan reviewer until it approves.\n"
                "Only then can implementation proceed."
            )
    except OSError:
        return False, "PLAN REVIEW GATE: Could not read .planning/PLAN_REVIEWED.md."

    return True, ""


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')

    # Only gate Agent tool calls (implementation subagent spawning)
    if tool_name != 'Agent':
        sys.exit(0)

    # Use cwd from hook input, fall back to environment
    cwd = hook_input.get('cwd', os.getcwd())

    approved, reason = check_plan_reviewed(cwd)
    if approved:
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
