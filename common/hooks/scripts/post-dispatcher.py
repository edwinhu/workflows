#!/usr/bin/env python3
"""
PostToolUse Dispatcher: Handles writing workflow checks after tool execution.

Only runs when writing workflow is active.
"""

import json
import re
import sys
import os
from typing import NamedTuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session import is_workflow_active

# Early exit if writing workflow not active
if not is_workflow_active('writing'):
    sys.exit(0)


class Pattern(NamedTuple):
    regex: str
    name: str
    fix: str


CRITICAL_PATTERNS = [
    Pattern(r'turn\d+search\d+', 'ChatGPT artifact', 'Remove'),
    Pattern(r'oaicite:\d+', 'ChatGPT citation', 'Remove'),
    Pattern(r'As an AI', 'AI self-reference', 'Rewrite'),
]

HIGH_PATTERNS = [
    Pattern(r'\bstands as\b', '"stands as"', 'Be specific'),
    Pattern(r'\brich tapestry\b', '"rich tapestry"', 'Describe specifically'),
    Pattern(r'\bdelves? into\b', '"delves into"', 'Use "examines"'),
    Pattern(r'\bgroundbreaking\b', '"groundbreaking"', 'Describe what it does'),
    Pattern(r'\bseamlessly\b', '"seamlessly"', 'Describe how'),
    Pattern(r'\bleverag', '"leverage"', 'Use "use"'),
]


def check_patterns(content: str, patterns: list[Pattern]) -> list[tuple[Pattern, list[str]]]:
    matches = []
    for pattern in patterns:
        found = re.findall(pattern.regex, content, re.IGNORECASE)
        if found:
            matches.append((pattern, list(set(found))[:2]))
    return matches


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    if tool_name not in ('Write', 'Edit'):
        sys.exit(0)

    tool_input = hook_input.get('tool_input', {})
    content = tool_input.get('content', '') or tool_input.get('new_string', '')

    if len(content) < 100:
        sys.exit(0)

    # Skip code files
    file_path = tool_input.get('file_path', '')
    if file_path.endswith(('.py', '.js', '.ts', '.sh', '.json', '.yaml', '.yml', '.css', '.html', '.sql')):
        sys.exit(0)

    critical = check_patterns(content, CRITICAL_PATTERNS)
    high = check_patterns(content, HIGH_PATTERNS)

    if critical or high:
        lines = ["AI WRITING ANTI-PATTERNS DETECTED", ""]
        if critical:
            lines.append("CRITICAL:")
            for p, _ in critical:
                lines.append(f"  - {p.name}: {p.fix}")
        if high:
            lines.append("HIGH:")
            for p, _ in high:
                lines.append(f"  - {p.name}: {p.fix}")
        print(json.dumps({"systemMessage": "\n".join(lines)}))


if __name__ == '__main__':
    main()
