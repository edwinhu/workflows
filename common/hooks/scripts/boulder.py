#!/usr/bin/env python3
"""
Boulder State Management

Persistent plan tracking across Claude sessions.
Boulder state tracks the active work plan, progress, and session history.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import TypedDict


class BoulderProgress(TypedDict):
    """Progress tracking for plan checkboxes"""
    total: int
    completed: int


class BoulderState(TypedDict):
    """Boulder state structure"""
    active_plan: str
    project_root: str
    plan_name: str
    started_at: str
    session_ids: list[str]
    progress: BoulderProgress
    metadata: dict


def get_boulder_path() -> Path:
    """Return ~/.claude/.boulder.json path"""
    return Path.home() / '.claude' / '.boulder.json'


def read_boulder_state() -> BoulderState | None:
    """
    Read boulder.json, return None if missing/invalid.

    Returns:
        BoulderState dict if exists, None otherwise
    """
    boulder_path = get_boulder_path()

    if not boulder_path.exists():
        return None

    try:
        content = boulder_path.read_text(encoding='utf-8')
        state = json.loads(content)

        # Validate required fields
        required_fields = ['active_plan', 'project_root', 'plan_name', 'started_at', 'session_ids', 'progress']
        if not all(field in state for field in required_fields):
            return None

        return state
    except (json.JSONDecodeError, IOError):
        return None


def write_boulder_state(state: BoulderState) -> bool:
    """
    Write boulder.json atomically.

    Args:
        state: Boulder state dictionary

    Returns:
        True if successful, False otherwise
    """
    boulder_path = get_boulder_path()

    # Ensure parent directory exists
    boulder_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Atomic write: write to temp file, then rename
        temp_path = boulder_path.with_suffix('.tmp')
        temp_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
        temp_path.replace(boulder_path)
        return True
    except (IOError, OSError):
        return False


def create_boulder_state(
    plan_path: str,
    project_root: str,
    plan_name: str
) -> BoulderState:
    """
    Create new boulder state dictionary.

    Args:
        plan_path: Absolute path to PLAN.md
        project_root: Absolute path to project root
        plan_name: Name of the plan (e.g., "feature-x")

    Returns:
        New BoulderState dict with initial values
    """
    # Count initial checkboxes
    total, completed = count_plan_checkboxes(plan_path)

    return {
        'active_plan': plan_path,
        'project_root': project_root,
        'plan_name': plan_name,
        'started_at': datetime.now().isoformat(),
        'session_ids': [],
        'progress': {
            'total': total,
            'completed': completed
        },
        'metadata': {}
    }


def append_session_id(session_id: str) -> bool:
    """
    Add session ID to boulder.session_ids.

    Args:
        session_id: Session ID to append

    Returns:
        True if successful, False otherwise
    """
    state = read_boulder_state()
    if not state:
        return False

    if session_id not in state['session_ids']:
        state['session_ids'].append(session_id)
        return write_boulder_state(state)

    return True


def count_plan_checkboxes(plan_path: str) -> tuple[int, int]:
    """
    Return (total, completed) checkbox counts from PLAN.md.

    Counts markdown checkboxes:
    - [ ] → unchecked
    - [x] or [X] → checked

    Args:
        plan_path: Path to PLAN.md file

    Returns:
        Tuple of (total_checkboxes, completed_checkboxes)
    """
    path = Path(plan_path)
    if not path.exists():
        return (0, 0)

    try:
        content = path.read_text(encoding='utf-8')
    except (IOError, UnicodeDecodeError):
        return (0, 0)

    # Match: - [ ] or - [x] or - [X]
    # Use regex to find all checkbox patterns at start of line
    unchecked_pattern = r'^[-*]\s*\[\s*\]'
    checked_pattern = r'^[-*]\s*\[[xX]\]'

    unchecked = len(re.findall(unchecked_pattern, content, re.MULTILINE))
    checked = len(re.findall(checked_pattern, content, re.MULTILINE))

    total = unchecked + checked
    completed = checked

    return (total, completed)


def update_boulder_progress(plan_path: str) -> bool:
    """
    Recount checkboxes, update boulder progress.

    Args:
        plan_path: Path to PLAN.md file

    Returns:
        True if updated successfully, False otherwise
    """
    state = read_boulder_state()
    if not state:
        return False

    total, completed = count_plan_checkboxes(plan_path)
    state['progress']['total'] = total
    state['progress']['completed'] = completed

    return write_boulder_state(state)


def clear_boulder_state() -> bool:
    """
    Delete boulder.json.

    Returns:
        True if deleted or already missing, False on error
    """
    boulder_path = get_boulder_path()

    if not boulder_path.exists():
        return True

    try:
        boulder_path.unlink()
        return True
    except OSError:
        return False


def is_plan_complete(plan_path: str) -> bool:
    """
    Check if all checkboxes are checked in plan.

    Args:
        plan_path: Path to PLAN.md file

    Returns:
        True if all tasks complete or no tasks, False otherwise
    """
    total, completed = count_plan_checkboxes(plan_path)

    # If no checkboxes, consider complete (avoids infinite boulder)
    if total == 0:
        return True

    return completed == total


def find_project_plan(project_root: str) -> str | None:
    """
    Find .claude/PLAN.md in project root.

    Args:
        project_root: Project root directory

    Returns:
        Absolute path to PLAN.md if exists, None otherwise
    """
    plan_path = Path(project_root) / '.claude' / 'PLAN.md'
    return str(plan_path.absolute()) if plan_path.exists() else None


def infer_plan_name(plan_path: str) -> str:
    """
    Infer plan name from PLAN.md content.

    Looks for first H1 heading (# Title) in file.
    Falls back to "plan" if no heading found.

    Args:
        plan_path: Path to PLAN.md file

    Returns:
        Plan name string
    """
    path = Path(plan_path)
    if not path.exists():
        return "plan"

    try:
        content = path.read_text(encoding='utf-8')

        # Find first H1 heading: # Title
        match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
        if match:
            title = match.group(1).strip()
            # Remove common prefixes
            title = re.sub(r'^(PLAN|Plan):\s*', '', title, flags=re.IGNORECASE)
            # Convert to slug
            slug = title.lower().replace(' ', '-')
            # Remove non-alphanumeric except hyphens
            slug = re.sub(r'[^a-z0-9-]', '', slug)
            return slug if slug else "plan"

        return "plan"
    except (IOError, UnicodeDecodeError):
        return "plan"


def auto_create_boulder_for_plan(plan_path: str) -> BoulderState | None:
    """
    Auto-create boulder state for existing PLAN.md.

    Used by SessionStart hook when PLAN.md exists without boulder.

    Args:
        plan_path: Absolute path to PLAN.md

    Returns:
        Created BoulderState or None if failed
    """
    path = Path(plan_path)
    if not path.exists():
        return None

    # Find project root (directory containing .claude/)
    project_root = path.parent.parent

    # Infer plan name from content
    plan_name = infer_plan_name(plan_path)

    # Create boulder state
    state = create_boulder_state(
        plan_path=str(path.absolute()),
        project_root=str(project_root.absolute()),
        plan_name=plan_name
    )

    # Write to disk
    if write_boulder_state(state):
        return state

    return None
