#!/usr/bin/env python3
"""
Boulder state management utilities (per-project)

Boulder files live at $PROJECT/.claude/.boulder.json, not globally.
Each project can have its own active plan without conflicts.
"""

import json
from pathlib import Path
from typing import Optional, Tuple
import tempfile
import shutil


def get_boulder_path(project_root: Path) -> Path:
    """Return $PROJECT/.claude/.boulder.json path"""
    return project_root / '.claude' / '.boulder.json'


def read_boulder_state(project_root: Path) -> Optional[dict]:
    """Read project's boulder.json, return None if missing/invalid"""
    boulder_path = get_boulder_path(project_root)

    if not boulder_path.exists():
        return None

    try:
        content = boulder_path.read_text(encoding='utf-8')
        return json.loads(content)
    except (json.JSONDecodeError, OSError):
        # Invalid or unreadable - treat as missing
        return None


def write_boulder_state(project_root: Path, state: dict) -> bool:
    """Write project's boulder.json atomically"""
    boulder_path = get_boulder_path(project_root)

    # Ensure .claude directory exists
    boulder_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Atomic write: temp file then rename
        with tempfile.NamedTemporaryFile(
            mode='w',
            encoding='utf-8',
            dir=boulder_path.parent,
            delete=False,
            suffix='.tmp'
        ) as tmp_file:
            json.dump(state, tmp_file, indent=2)
            tmp_path = Path(tmp_file.name)

        # Atomic rename
        shutil.move(str(tmp_path), str(boulder_path))
        return True
    except Exception:
        # Clean up temp file if it exists
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()
        return False


def create_boulder_state(
    plan_path: str,
    project_root: str,
    plan_name: str
) -> dict:
    """Create new boulder state dictionary"""
    from datetime import datetime

    return {
        "active_plan": plan_path,
        "project_root": project_root,
        "plan_name": plan_name,
        "started_at": datetime.now().isoformat(),
        "session_ids": [],
        "progress": {
            "total": 0,
            "completed": 0
        },
        "metadata": {}
    }


def append_session_id(project_root: Path, session_id: str) -> bool:
    """Add session ID to project's boulder.session_ids"""
    boulder = read_boulder_state(project_root)

    if not boulder:
        return False

    session_ids = boulder.get('session_ids', [])
    if session_id not in session_ids:
        session_ids.append(session_id)
        boulder['session_ids'] = session_ids
        return write_boulder_state(project_root, boulder)

    return True


def count_plan_checkboxes(plan_path: str) -> Tuple[int, int]:
    """Return (total, completed) checkbox counts"""
    path = Path(plan_path)

    if not path.exists():
        return (0, 0)

    try:
        content = path.read_text(encoding='utf-8')
    except OSError:
        return (0, 0)

    total = 0
    completed = 0

    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('- [ ]'):
            total += 1
        elif stripped.startswith('- [x]') or stripped.startswith('- [X]'):
            total += 1
            completed += 1

    return (total, completed)


def update_boulder_progress(project_root: Path, plan_path: str) -> bool:
    """Recount checkboxes, update project's boulder progress"""
    boulder = read_boulder_state(project_root)

    if not boulder:
        return False

    total, completed = count_plan_checkboxes(plan_path)

    boulder['progress'] = {
        'total': total,
        'completed': completed
    }

    return write_boulder_state(project_root, boulder)


def clear_boulder_state(project_root: Path) -> bool:
    """Delete project's boulder.json"""
    boulder_path = get_boulder_path(project_root)

    try:
        if boulder_path.exists():
            boulder_path.unlink()
        return True
    except OSError:
        return False


def is_plan_complete(plan_path: str) -> bool:
    """Check if all checkboxes are checked"""
    total, completed = count_plan_checkboxes(plan_path)

    if total == 0:
        return False

    return completed == total
