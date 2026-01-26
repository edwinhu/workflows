#!/usr/bin/env python3
"""
PostToolUse hook: Log PR URL after gh pr create.

When gh pr create succeeds, this hook extracts the PR URL from output
and logs it to LEARNINGS.md for easy reference.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path


def find_learnings_file() -> Path | None:
    """Find .claude/LEARNINGS.md in current project."""
    learnings_path = Path.cwd() / '.claude' / 'LEARNINGS.md'
    return learnings_path if learnings_path.exists() else None


def extract_pr_url(output: str) -> str | None:
    """Extract GitHub PR URL from gh pr create output."""
    # gh pr create outputs URL on success
    # Format: https://github.com/owner/repo/pull/123
    match = re.search(r'https://github\.com/[^/]+/[^/]+/pull/\d+', output)
    return match.group(0) if match else None


def log_pr_to_learnings(pr_url: str, learnings_path: Path) -> bool:
    """Append PR URL to LEARNINGS.md."""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    entry = f"\n- [{timestamp}] PR created: {pr_url}\n"

    try:
        with open(learnings_path, 'a', encoding='utf-8') as f:
            f.write(entry)
        return True
    except (IOError, OSError) as e:
        print(f"[PRLogger] Failed to log PR: {e}", file=sys.stderr)
        return False


def main():
    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, KeyError):
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})
    tool_result = hook_input.get('tool_result', {})

    # Only process Bash tool
    if tool_name != 'Bash':
        sys.exit(0)

    # Check if this was a gh pr create command
    command = tool_input.get('command', '')
    if 'gh pr create' not in command:
        sys.exit(0)

    # Get output from tool result
    output = tool_result.get('stdout', '') or tool_result.get('output', '')
    if not output:
        sys.exit(0)

    # Extract PR URL
    pr_url = extract_pr_url(output)
    if not pr_url:
        sys.exit(0)

    # Log to LEARNINGS.md (async - Claude won't wait for this)
    learnings_path = find_learnings_file()
    if learnings_path:
        if log_pr_to_learnings(pr_url, learnings_path):
            print(f"[PRLogger] Logged PR: {pr_url}", file=sys.stderr)

    sys.exit(0)


if __name__ == '__main__':
    main()
