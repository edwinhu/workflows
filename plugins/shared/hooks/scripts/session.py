#!/usr/bin/env python3
"""
Shared session utilities for dev/ds plugin hooks.
Provides consistent session identification across all hooks.
"""
import os
import hashlib


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
    return f"/tmp/.claude-dev-mode-{get_session_id()}"


def get_ralph_state_file() -> str:
    """Get path to session-specific ralph loop state."""
    return f"/tmp/.claude-ralph-{get_session_id()}.state"


def get_skill_gate_file() -> str:
    """Get path to session-specific skill gate."""
    return f"/tmp/.claude-skill-gate-{get_session_id()}"


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
    except:
        return False


def is_skill_gate_open() -> bool:
    """Check if skill gate is open for this session."""
    return os.path.exists(get_skill_gate_file())


def activate_dev_mode():
    """Activate dev mode for this session."""
    open(get_dev_mode_marker(), 'w').close()


def deactivate_dev_mode():
    """Deactivate dev mode for this session."""
    try:
        os.remove(get_dev_mode_marker())
    except FileNotFoundError:
        pass


def open_skill_gate():
    """Open the skill gate for this session."""
    open(get_skill_gate_file(), 'w').close()


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
