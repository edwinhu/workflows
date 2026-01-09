#!/usr/bin/env python3
"""
Common markdown validation utilities for PostToolUse hooks.

Provides shared validation logic for markdown content across different file types.
"""

from __future__ import annotations

import re
from typing import List, Tuple


def check_unescaped_dollars(content: str, context: str = "file") -> List[Tuple[int, str]]:
    """
    Check for unescaped dollar signs in markdown content.

    Dollar signs trigger LaTeX math rendering in most markdown renderers.
    They should be wrapped in backticks: `$50` not $50

    Args:
        content: The markdown content to check
        context: Description of what's being checked (for error messages)

    Returns:
        List of (line_number, line_content) tuples with issues
    """
    issues = []
    lines = content.split('\n')

    in_code_block = False
    code_block_fence = None

    for i, line in enumerate(lines, 1):
        # Track code blocks (``` or ~~~)
        fence_match = re.match(r'^(\s*)(```|~~~)', line)
        if fence_match:
            if not in_code_block:
                in_code_block = True
                code_block_fence = fence_match.group(2)
            elif fence_match.group(2) == code_block_fence:
                in_code_block = False
                code_block_fence = None
            continue

        # Skip lines inside code blocks
        if in_code_block:
            continue

        # Skip lines that are indented code blocks (4+ spaces)
        if line.startswith('    ') or line.startswith('\t'):
            continue

        # Find all dollar signs in the line
        # We need to check if they're outside backticks
        # Strategy: Remove all backtick-quoted sections, then check for $

        # Remove inline code (`...`)
        cleaned = line
        # Match backtick pairs and replace with placeholder
        cleaned = re.sub(r'`[^`]*`', '', cleaned)

        # Also remove escaped dollar signs (\$)
        cleaned = cleaned.replace(r'\$', '')

        # Now check if any $ remain
        if '$' in cleaned:
            # Find actual positions in original line for better error reporting
            # But only report if the $ is not in backticks or escaped

            # More precise check: find $ that's not preceded by \ and not inside ``
            unescaped_dollars = []
            in_backticks = False
            escaped = False

            for j, char in enumerate(line):
                if escaped:
                    escaped = False
                    continue

                if char == '\\':
                    escaped = True
                    continue

                if char == '`':
                    in_backticks = not in_backticks
                    continue

                if char == '$' and not in_backticks:
                    unescaped_dollars.append(j)

            if unescaped_dollars:
                issues.append((i, line.rstrip()))

    return issues


def format_dollar_issues(issues: List[Tuple[int, str]], filename: str, max_display: int = 5) -> str:
    """
    Format unescaped dollar sign issues for display.

    Args:
        issues: List of (line_number, line_content) tuples
        filename: Name of file being checked
        max_display: Maximum number of issues to display

    Returns:
        Formatted error message
    """
    if not issues:
        return None

    lines = [f"⚠️ Found {len(issues)} line(s) with unescaped $ in {filename}:"]
    lines.append("")
    lines.append("Dollar signs trigger LaTeX rendering. Wrap them in backticks:")

    for line_num, line_content in issues[:max_display]:
        # Truncate long lines
        display_line = line_content[:80] + '...' if len(line_content) > 80 else line_content
        lines.append(f"  Line {line_num}: {display_line}")

    if len(issues) > max_display:
        lines.append(f"  ... and {len(issues) - max_display} more")

    lines.append("")
    lines.append("Examples:")
    lines.append("  ❌ The cost is $50        ✅ The cost is `$50`")
    lines.append("  ❌ Set $HOME variable     ✅ Set `$HOME` variable")

    return '\n'.join(lines)
