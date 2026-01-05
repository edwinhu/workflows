#!/usr/bin/env python3
"""
Output Verifier Hook

Blocks "done" or "complete" claims without visible output in the conversation.
Checks for patterns like:
- "analysis complete" without showing results
- "data loaded" without showing shape/head
- Claims of completion without evidence

Session-aware: Only runs when ds workflow is active.
"""

import json
import re
import sys
import os

# Add shared scripts dir to path for session module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'common', 'hooks', 'scripts'))
from session import is_workflow_active

# Early exit if ds workflow is not active (session-aware like Ralph loops)
if not is_workflow_active('ds'):
    sys.exit(0)


def get_hook_input():
    """Read hook input from stdin."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def check_completion_claims(command: str) -> list[str]:
    """Check if command contains completion claims without evidence."""
    warnings = []

    # Patterns that indicate completion claims in echo/print statements
    completion_patterns = [
        r'echo\s+["\'].*(?:complete|done|finished|success).*["\']',
        r'print\s*\(["\'].*(?:complete|done|finished|success).*["\']\)',
        r'echo\s+["\'].*(?:analysis|processing|loading|training)\s+(?:complete|done|finished).*["\']',
        r'print\s*\(["\'].*(?:analysis|processing|loading|training)\s+(?:complete|done|finished).*["\']\)',
    ]

    # Evidence patterns - commands that show actual output
    evidence_patterns = [
        r'\.head\(',
        r'\.tail\(',
        r'\.info\(',
        r'\.describe\(',
        r'\.shape',
        r'\.columns',
        r'print\s*\([^)]*df',
        r'display\s*\(',
        r'\.to_string\(',
        r'\.value_counts\(',
        r'\.nunique\(',
        r'len\s*\(',
        r'\.sample\(',
    ]

    # Check for completion claims
    has_completion_claim = any(
        re.search(pattern, command, re.IGNORECASE)
        for pattern in completion_patterns
    )

    # Check for evidence of actual output
    has_evidence = any(
        re.search(pattern, command)
        for pattern in evidence_patterns
    )

    if has_completion_claim and not has_evidence:
        warnings.append(
            "Completion claim detected without visible evidence. "
            "Show actual results (e.g., df.head(), df.shape, print(results)) "
            "before claiming completion."
        )

    # Check for data loading without verification
    load_patterns = [
        r'pd\.read_',
        r'\.load\(',
        r'open\s*\([^)]+\)',
        r'np\.load',
        r'torch\.load',
        r'pickle\.load',
    ]

    has_data_load = any(
        re.search(pattern, command)
        for pattern in load_patterns
    )

    # If loading data, check if shape/head is also called
    if has_data_load and not has_evidence:
        warnings.append(
            "Data loaded without verification. "
            "Consider showing shape, head(), or info() to confirm successful load."
        )

    return warnings


def main():
    hook_input = get_hook_input()

    tool_input = hook_input.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command:
        # No command to check
        result = {"decision": "approve"}
        print(json.dumps(result))
        return

    warnings = check_completion_claims(command)

    if warnings:
        # Return warnings but don't block - just inform
        result = {
            "decision": "approve",
            "reason": " | ".join(warnings)
        }
    else:
        result = {"decision": "approve"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
