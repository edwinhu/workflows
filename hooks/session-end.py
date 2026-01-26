#!/usr/bin/env python3
"""
Stop hook: Update LEARNINGS.md timestamp when session ends.

Updates the existing LEARNINGS.md file with a timestamp, maintaining the
PLAN.md + LEARNINGS.md workflow pattern.
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


def update_learnings_timestamp(learnings_path: Path) -> bool:
    """
    Add or update timestamp at the end of LEARNINGS.md.

    Format: --- Last updated: YYYY-MM-DD HH:MM ---
    """
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M')
    footer = f"\n---\nLast updated: {timestamp}\n---\n"

    try:
        content = learnings_path.read_text(encoding='utf-8')

        # Remove existing footer if present
        content = re.sub(r'\n---\nLast updated:.*\n---\n?$', '', content)

        # Add new footer
        content = content.rstrip() + footer

        learnings_path.write_text(content, encoding='utf-8')
        return True
    except (IOError, OSError) as e:
        print(f"[SessionEnd] Failed to update LEARNINGS.md: {e}", file=sys.stderr)
        return False


def main():
    # Read hook input (optional - may not have session info)
    try:
        hook_input = json.loads(sys.stdin.read())
        session_id = hook_input.get('sessionId', 'unknown')
    except (json.JSONDecodeError, KeyError):
        session_id = 'unknown'

    # Find and update LEARNINGS.md
    learnings_path = find_learnings_file()
    if learnings_path:
        if update_learnings_timestamp(learnings_path):
            print(f"[SessionEnd] Updated {learnings_path}", file=sys.stderr)

    # Exit cleanly (Stop hooks should not block)
    sys.exit(0)


if __name__ == '__main__':
    main()
