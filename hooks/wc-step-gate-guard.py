#!/usr/bin/env python3
"""
PreToolUse hook: Multi-step gate guard for workflow-creator.

Enforces prerequisite step completion before allowing writes to specific files.
Each target file/directory has a required prerequisite step that must be completed
in .planning/wc/*/STATE.md before the write is allowed.

Step chain (mode: create only):
  .planning/wc/{name}/INTERVIEW.md  → requires 1-philosophy
  .planning/wc/{name}/DESIGN.md     → requires 2-interview
  skills/*.md                        → requires 5-entry-points
  constraints/                       → requires 5-entry-points
"""

import json
import os
import re
import sys
from pathlib import Path


def find_active_wc_state():
    """Find the most recently modified STATE.md in .planning/wc/*/."""
    wc_dir = Path(".planning/wc")
    if not wc_dir.exists():
        return None

    state_files = list(wc_dir.glob("*/STATE.md"))
    if not state_files:
        return None

    return max(state_files, key=lambda p: p.stat().st_mtime)


def get_completed_steps(state_path):
    """Extract all completed steps from STATE.md."""
    try:
        content = state_path.read_text()
    except Exception:
        return set()

    if not re.search(r'mode:\s*create', content):
        return {"__ALL__"}

    completed = set()
    for match in re.finditer(r'step:\s*(\S+)', content):
        step = match.group(1)
        step_pos = match.start()
        rest = content[step_pos:step_pos + 200]
        if re.search(r'status:\s*completed', rest):
            completed.add(step)

    return completed


def match_file_to_gate(file_path):
    """Match a file path to its required prerequisite gate.

    Returns (required_step, description) or None if no gate applies.
    """
    p = Path(file_path)
    parts = p.parts
    name = p.name

    if name in ("STATE.md", "HANDOFF.md", "SCORES.md"):
        return None

    if '.planning' in parts or '.claude' in parts:
        if 'wc' in parts:
            if name == "INTERVIEW.md":
                return ("1-philosophy", "Step 1 (philosophy) must be completed before writing INTERVIEW.md")
            if name == "DESIGN.md":
                return ("2-interview", "Step 2 (interview) must be completed before writing DESIGN.md")
        return None

    if 'skills' in parts and p.suffix == '.md':
        return ("5-entry-points", "Steps 1-5 must be completed before generating skill files")

    if 'constraints' in parts:
        return ("5-entry-points", "Steps 1-5 must be completed before generating constraint files")

    return None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name not in ('Write', 'Edit'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    state_path = find_active_wc_state()
    if not state_path:
        sys.exit(0)

    completed_steps = get_completed_steps(state_path)

    if "__ALL__" in completed_steps:
        sys.exit(0)

    gate = match_file_to_gate(file_path)
    if not gate:
        sys.exit(0)

    required_step, gate_description = gate

    if required_step not in completed_steps:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"GATE BLOCKED: {gate_description}\n\n"
                    f"Required: STATE.md must show `step: {required_step}, status: completed` "
                    f"before this write is allowed.\n\n"
                    f"**Remedy:** Complete step {required_step} first and update STATE.md."
                )
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
