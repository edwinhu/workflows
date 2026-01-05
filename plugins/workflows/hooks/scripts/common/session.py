#!/usr/bin/env python3
"""
Shared session utilities for dev/ds plugin hooks.
Provides consistent session identification across all hooks.
"""
import os
import hashlib
from pathlib import Path


def _get_cache_dir() -> Path:
    """Get user-specific cache directory for hook state files.

    Creates ~/.cache/claude/hooks/ with restricted permissions (0o700).
    """
    cache_dir = Path.home() / ".cache" / "claude" / "hooks"
    if not cache_dir.exists():
        cache_dir.mkdir(parents=True, mode=0o700)
    return cache_dir


def get_session_id() -> str:
    """Generate a stable session ID based on TTY and CWD.

    Note: PPID is NOT used because each bash command spawns a new subprocess
    with a different parent PID, making it unstable across commands.
    """
    tty = os.environ.get('TTY', '')
    cwd = os.getcwd()
    return hashlib.md5(f"{tty}:{cwd}".encode()).hexdigest()[:12]


def get_dev_mode_marker() -> str:
    """Get path to session-specific dev mode marker."""
    return str(_get_cache_dir() / f".claude-dev-mode-{get_session_id()}")


def get_ralph_state_file() -> str:
    """Get path to session-specific ralph loop state."""
    return str(_get_cache_dir() / f".claude-ralph-{get_session_id()}.state")


def get_skill_gate_file() -> str:
    """Get path to session-specific skill gate."""
    return str(_get_cache_dir() / f".claude-skill-gate-{get_session_id()}")


def is_dev_mode_active() -> bool:
    """Check if dev mode is active for this session."""
    return os.path.exists(get_dev_mode_marker())


def is_ralph_loop_active() -> bool:
    """Check if a ralph loop is active for this session."""
    state_file = get_ralph_state_file()
    if not os.path.exists(state_file):
        return False
    try:
        with open(state_file, 'r') as f:
            return 'active: true' in f.read()
    except Exception:
        return False


def is_skill_gate_open() -> bool:
    """Check if skill gate is open for this session."""
    return os.path.exists(get_skill_gate_file())


def activate_dev_mode():
    """Activate dev mode for this session."""
    Path(get_dev_mode_marker()).touch()


def deactivate_dev_mode():
    """Deactivate dev mode for this session."""
    try:
        os.remove(get_dev_mode_marker())
    except FileNotFoundError:
        pass


def open_skill_gate():
    """Open the skill gate for this session."""
    Path(get_skill_gate_file()).touch()


def close_skill_gate():
    """Close the skill gate for this session."""
    try:
        os.remove(get_skill_gate_file())
    except FileNotFoundError:
        pass


def start_ralph_loop(task: str, max_iterations: int = 30):
    """Mark ralph loop as active for this session."""
    with open(get_ralph_state_file(), 'w') as f:
        f.write(f"active: true\ntask: {task}\nmax_iterations: {max_iterations}\n")


def stop_ralph_loop():
    """Mark ralph loop as inactive for this session."""
    try:
        os.remove(get_ralph_state_file())
    except FileNotFoundError:
        pass


def cleanup_session():
    """Clean up all session-specific files."""
    for path in [get_dev_mode_marker(), get_ralph_state_file(), get_skill_gate_file()]:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
    # Clean all workflow markers
    for workflow in ['dev', 'ds', 'writing']:
        deactivate_workflow(workflow)


# =============================================================================
# Workflow-specific tracking (session-aware hooks)
# =============================================================================

def get_workflow_marker(workflow: str) -> str:
    """Get path to session-specific workflow marker (dev, ds, writing)."""
    return str(_get_cache_dir() / f".claude-workflow-{workflow}-{get_session_id()}")


def is_workflow_active(workflow: str) -> bool:
    """Check if specific workflow is active for this session.

    Hooks should call this early and exit(0) if their workflow isn't active.
    This makes hooks session-aware like Ralph Wiggum loops.
    """
    return os.path.exists(get_workflow_marker(workflow))


def activate_workflow(workflow: str):
    """Activate a specific workflow for this session.

    Called by skill-activator when /dev:start, /ds:start, or /writing is invoked.
    """
    Path(get_workflow_marker(workflow)).touch()


def deactivate_workflow(workflow: str):
    """Deactivate a specific workflow for this session."""
    try:
        os.remove(get_workflow_marker(workflow))
    except FileNotFoundError:
        pass


def get_active_workflows() -> list:
    """Get list of active workflows for this session."""
    active = []
    for workflow in ['dev', 'ds', 'writing']:
        if is_workflow_active(workflow):
            active.append(workflow)
    return active
