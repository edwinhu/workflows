#!/usr/bin/env python3
"""
PreToolUse hook: Block skill file generation until prerequisite steps are completed.

Workflow-creator specific gate guard. Checks that .planning/wc/*/STATE.md shows
required prerequisite steps as completed before allowing Write/Edit to skill files.

Environment variables:
  WC_REQUIRED_STEP=3b-artifact-review   (step that must be completed)
  WC_GATE_DESCRIPTION=Decomposition     (human-readable phase name)

Grounded in: April 2026 self-audit — workflow-creator's own step transitions were
advisory "IMMEDIATELY proceed" text, the exact anti-pattern it flags in generated
workflows. This hook enforces the structural gate it preaches.
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
    """Extract completed steps from STATE.md content."""
    try:
        content = state_path.read_text()
    except Exception:
        return set()

    completed = set()
    # Look for "step: X" and "status: completed" patterns
    step_match = re.search(r'step:\s*(\S+)', content)
    status_match = re.search(r'status:\s*(\S+)', content)

    if step_match and status_match:
        if status_match.group(1).lower() == 'completed':
            completed.add(step_match.group(1))

    # Also check for historical entries (multi-document YAML or repeated fields)
    for match in re.finditer(r'step:\s*(\S+).*?status:\s*completed', content, re.DOTALL):
        completed.add(match.group(1))

    return completed


def is_skill_file(file_path):
    """Check if the target file is a generated skill file (not state/planning)."""
    p = Path(file_path)
    parts = p.parts

    # Allow writes to .planning/ and .claude/
    if '.planning' in parts or '.claude' in parts:
        return False

    # Check if it's a skill file
    if 'skills' in parts and p.suffix == '.md':
        return True

    # Check if it's a constraint file
    if 'constraints' in parts:
        return True

    return False


def main():
    required_step = os.environ.get('WC_REQUIRED_STEP', '')
    gate_description = os.environ.get('WC_GATE_DESCRIPTION', 'Previous step')

    if not required_step:
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Only check Write and Edit
    if tool_name not in ('Write', 'Edit'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path or not is_skill_file(file_path):
        sys.exit(0)

    # Find active STATE.md
    state_path = find_active_wc_state()
    if not state_path:
        # No wc state — might not be in a workflow-creator session
        sys.exit(0)

    completed_steps = get_completed_steps(state_path)

    # Check if required step is completed
    if required_step not in completed_steps:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"GATE BLOCKED: {gate_description} step not completed.\n\n"
                    f"Required: STATE.md must show `step: {required_step}, status: completed` "
                    f"before generating/editing skill files.\n\n"
                    f"This prevents skipping prerequisite steps (interview, decomposition, "
                    f"enforcement design) when generating workflow files.\n\n"
                    f"**Remedy:** Complete step {required_step} first and update STATE.md."
                )
            }
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
