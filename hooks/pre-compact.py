#!/usr/bin/env python3
"""
PreCompact hook: Save state before context compaction.

1. Adds a compaction marker to LEARNINGS.md
2. Detects active workflow from PLAN.md
3. Outputs additionalContext with skill reload instructions

This helps Claude remember to reload workflow skills after compaction.
See: https://github.com/anthropics/claude-code/issues/13919
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

# Workflow patterns to detect in PLAN.md
WORKFLOW_PATTERNS = {
    'dev': [r'## Dev Workflow', r'/dev\b', r'TDD', r'RED-GREEN-REFACTOR'],
    'ds': [r'## DS Workflow', r'/ds\b', r'data science', r'EDA'],
    'writing': [r'## Writing', r'/writing\b', r'draft', r'revision'],
}


def find_learnings_file() -> Path | None:
    """Find .claude/LEARNINGS.md in current project."""
    learnings_path = Path.cwd() / '.claude' / 'LEARNINGS.md'
    return learnings_path if learnings_path.exists() else None


def find_plan_file() -> Path | None:
    """Find .claude/PLAN.md in current project."""
    plan_path = Path.cwd() / '.claude' / 'PLAN.md'
    return plan_path if plan_path.exists() else None


def detect_active_workflow(plan_path: Path) -> str | None:
    """Detect which workflow is active from PLAN.md content."""
    try:
        content = plan_path.read_text(encoding='utf-8')
        for workflow, patterns in WORKFLOW_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, content, re.IGNORECASE):
                    return workflow
        return None
    except (IOError, OSError):
        return None


def append_compaction_marker(learnings_path: Path, workflow: str | None) -> bool:
    """Append compaction marker to LEARNINGS.md."""
    timestamp = datetime.now().strftime('%H:%M')
    workflow_note = f" (workflow: /{workflow})" if workflow else ""
    marker = f"\n[Compaction at {timestamp}]{workflow_note} - Context was summarized\n"

    try:
        with open(learnings_path, 'a', encoding='utf-8') as f:
            f.write(marker)
        return True
    except (IOError, OSError) as e:
        print(f"[PreCompact] Failed to update LEARNINGS.md: {e}", file=sys.stderr)
        return False


def main():
    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, KeyError):
        hook_input = {}

    # Detect active workflow from PLAN.md
    plan_path = find_plan_file()
    active_workflow = detect_active_workflow(plan_path) if plan_path else None

    # Update LEARNINGS.md with compaction marker
    learnings_path = find_learnings_file()
    if learnings_path:
        append_compaction_marker(learnings_path, active_workflow)

    # Build reload instructions for additionalContext
    reload_instructions = []

    if active_workflow:
        reload_instructions.append(
            f"IMPORTANT: The /{active_workflow} workflow was active before compaction. "
            f"After compaction completes, invoke /{active_workflow} to reload the workflow context."
        )
    else:
        reload_instructions.append(
            "After compaction, check .claude/PLAN.md to determine which workflow "
            "was in use (/dev, /ds, or /writing) and reload it."
        )

    # Always remind about LEARNINGS.md
    if learnings_path:
        reload_instructions.append(
            "Read .claude/LEARNINGS.md for session context and recent progress."
        )

    # Output additionalContext to be included in compaction summary
    if reload_instructions:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PreCompact",
                "additionalContext": "\n".join(reload_instructions)
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
