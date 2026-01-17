#!/usr/bin/env python3
"""
Markdown PostToolUse Hook: Validates markdown files for common rendering issues.

Checks for:
- Unescaped dollar signs (trigger LaTeX rendering)

Non-blocking: Reports issues as warnings.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Add lib/hooks to path for shared utilities
sys.path.insert(0, str(Path(__file__).parent.parent / 'lib' / 'hooks'))
from markdown_validators import check_unescaped_dollars, format_dollar_issues


def is_markdown_file(file_path: str) -> bool:
    """Check if file is a markdown file."""
    return file_path.endswith(('.md', '.markdown', '.mdown', '.mkdn'))


def validate_markdown_file(file_path: str) -> tuple[bool, str]:
    """
    Validate markdown file for common issues.

    Returns (success, message) where message is None if no issues.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return True, None  # Can't read file, don't block

    # Check for unescaped dollar signs
    dollar_issues = check_unescaped_dollars(content, "markdown file")

    if dollar_issues:
        filename = os.path.basename(file_path)
        message = format_dollar_issues(dollar_issues, filename)
        return False, message

    return True, None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Only check Edit and Write tools
    if tool_name not in ('Edit', 'Write'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Check if it's a markdown file
    if not is_markdown_file(file_path):
        sys.exit(0)

    # Validate the file
    success, message = validate_markdown_file(file_path)

    if not success and message:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "message": message
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
