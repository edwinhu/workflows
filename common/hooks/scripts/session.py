#!/usr/bin/env python3
"""
Shared session utilities for dev/ds plugin hooks.
Uses /tmp/claude-workflow-{ppid}/ for session state - matches bash commands.
"""
from __future__ import annotations

import os
import glob
from pathlib import Path
from typing import Optional


def get_session_dir() -> Path:
    """Get session directory using PPID.

    When Claude spawns processes (bash, hooks), they all share the same parent.
    So os.getppid() is consistent across all tools/hooks in a session.
    """
    return Path(f"/tmp/claude-workflow-{os.getppid()}")


def get_session_dir_any() -> Optional[Path]:
    """Find any session directory (for cleanup or when PPID is uncertain)."""
    dirs = glob.glob("/tmp/claude-workflow-*")
    return Path(dirs[0]) if dirs else None


def is_dev_mode_active() -> bool:
    """Check if dev mode (sandbox) is active for this session."""
    session_dir = get_session_dir()
    return (session_dir / "dev_mode").exists()


def activate_dev_mode():
    """Activate dev mode (sandbox) for this session."""
    session_dir = get_session_dir()
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "dev_mode").touch()


def deactivate_dev_mode():
    """Deactivate dev mode (sandbox) for this session."""
    session_dir = get_session_dir()
    try:
        (session_dir / "dev_mode").unlink()
    except FileNotFoundError:
        pass


def is_workflow_active(workflow: str) -> bool:
    """Check if specific workflow is active for this session."""
    session_dir = get_session_dir()
    return (session_dir / f"workflow_{workflow}").exists()


def activate_workflow(workflow: str):
    """Activate a specific workflow for this session."""
    session_dir = get_session_dir()
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / f"workflow_{workflow}").touch()


def deactivate_workflow(workflow: str):
    """Deactivate a specific workflow for this session."""
    session_dir = get_session_dir()
    try:
        (session_dir / f"workflow_{workflow}").unlink()
    except FileNotFoundError:
        pass


def get_active_workflows() -> list:
    """Get list of active workflows for this session."""
    active = []
    for workflow in ['dev', 'ds', 'writing']:
        if is_workflow_active(workflow):
            active.append(workflow)
    return active


def cleanup_session():
    """Clean up session directory."""
    import shutil
    session_dir = get_session_dir()
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)


# =============================================================================
# Ralph loop state (kept for compatibility)
# =============================================================================

def is_ralph_loop_active() -> bool:
    """Check if a ralph loop is active for this session."""
    session_dir = get_session_dir()
    state_file = session_dir / "ralph_loop"
    return state_file.exists()


def start_ralph_loop(task: str, max_iterations: int = 30):
    """Mark ralph loop as active for this session."""
    session_dir = get_session_dir()
    session_dir.mkdir(parents=True, exist_ok=True)
    with open(session_dir / "ralph_loop", 'w') as f:
        f.write(f"task: {task}\nmax_iterations: {max_iterations}\n")


def stop_ralph_loop():
    """Mark ralph loop as inactive for this session."""
    session_dir = get_session_dir()
    try:
        (session_dir / "ralph_loop").unlink()
    except FileNotFoundError:
        pass


# =============================================================================
# Skill gate (kept for compatibility)
# =============================================================================

def is_skill_gate_open() -> bool:
    """Check if skill gate is open for this session."""
    session_dir = get_session_dir()
    return (session_dir / "skill_gate").exists()


def open_skill_gate():
    """Open the skill gate for this session."""
    session_dir = get_session_dir()
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "skill_gate").touch()


def close_skill_gate():
    """Close the skill gate for this session."""
    session_dir = get_session_dir()
    try:
        (session_dir / "skill_gate").unlink()
    except FileNotFoundError:
        pass
