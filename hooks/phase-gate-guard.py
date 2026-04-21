#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Block code-modifying tools if a required gate artifact is missing.

Generic phase-gate enforcer. Each skill that needs a gate passes the required
artifact path and a human-readable gate description via environment variables:

  GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
  GATE_STATUS=APPROVED           (optional: required frontmatter status value)
  GATE_DESCRIPTION=Plan review   (human-readable name for error messages)
  GATE_REMEDY=Return to dev-design and run dev-plan-reviewer
  GATE_BLOCKED_TOOLS=Write,Edit,Bash,Agent  (optional: default Write|Edit)

Scoped to individual phase skills via frontmatter hooks. The skill sets env vars
in the hook command, making this one script reusable across all workflow phases.

Usage in SKILL.md frontmatter:
  hooks:
    PreToolUse:
      - matcher: "Write|Edit|Agent"
        hooks:
          - type: command
            command: >-
              GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
              GATE_STATUS=APPROVED
              GATE_DESCRIPTION="Plan review"
              GATE_REMEDY="Return to dev-design and run dev-plan-reviewer"
              uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py

Grounded in: April 2026 meta-audit — workflow-creator found that advisory gates
("you must run X first") were systematically skipped under context pressure.
Hooks are runtime-enforced by Claude Code; Claude cannot rationalize past them.
"""

import json
import os
import sys
from pathlib import Path


# Tools that this hook can block (configured per-skill via env var)
DEFAULT_BLOCKED_TOOLS = {'Write', 'Edit'}

# Files that are always allowed (workflow state, not project code)
ALWAYS_ALLOWED_DIRS = {'.planning', '.claude'}


def check_artifact_exists(artifact_path: str) -> bool:
    """Check if the gate artifact file exists."""
    return Path(artifact_path).is_file()


def check_artifact_status(artifact_path: str, required_status: str) -> bool:
    """Check if the artifact's frontmatter contains the required status."""
    try:
        text = Path(artifact_path).read_text()
    except Exception:
        return False

    # Parse YAML frontmatter (between --- delimiters)
    if not text.startswith('---'):
        return False
    parts = text.split('---', 2)
    if len(parts) < 3:
        return False
    frontmatter = parts[1]

    # Simple status check — look for "status: VALUE" line
    for line in frontmatter.strip().splitlines():
        line = line.strip()
        if line.startswith('status:'):
            value = line.split(':', 1)[1].strip().strip('"').strip("'")
            return value.upper() == required_status.upper()

    return False


def is_allowed_path(file_path: str) -> bool:
    """Check if the target file is in an always-allowed directory."""
    parts = Path(file_path).parts
    return any(d in parts for d in ALWAYS_ALLOWED_DIRS)


def main():
    # Read hook configuration from environment
    artifact_path = os.environ.get('GATE_ARTIFACT', '')
    required_status = os.environ.get('GATE_STATUS', '')
    gate_description = os.environ.get('GATE_DESCRIPTION', 'Phase gate')
    gate_remedy = os.environ.get('GATE_REMEDY', 'Complete the previous phase first')
    blocked_tools_str = os.environ.get('GATE_BLOCKED_TOOLS', '')

    if not artifact_path:
        # No gate configured — allow everything
        sys.exit(0)

    # Parse blocked tools
    if blocked_tools_str:
        blocked_tools = {t.strip() for t in blocked_tools_str.split(',')}
    else:
        blocked_tools = DEFAULT_BLOCKED_TOOLS

    # Read hook input
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Only check blocked tools
    if tool_name not in blocked_tools:
        sys.exit(0)

    # Allow writes to workflow state dirs (.planning/, .claude/)
    file_path = tool_input.get('file_path', '')
    if file_path and is_allowed_path(file_path):
        sys.exit(0)

    # For Bash/Agent, always check (no file_path to exempt)
    # For Write/Edit, we already checked the path above

    # --- Gate check ---

    if not check_artifact_exists(artifact_path):
        deny(
            tool_name, file_path,
            f"GATE BLOCKED: {gate_description} artifact missing.\n\n"
            f"Required: `{artifact_path}` — file does not exist.\n\n"
            f"This phase cannot proceed without the gate artifact from the "
            f"previous phase. The artifact proves the gate actually ran — "
            f"instructional text alone is not enforcement.\n\n"
            f"**Remedy:** {gate_remedy}"
        )

    if required_status and not check_artifact_status(artifact_path, required_status):
        deny(
            tool_name, file_path,
            f"GATE BLOCKED: {gate_description} — wrong status.\n\n"
            f"Required: `{artifact_path}` with `status: {required_status}`\n"
            f"The file exists but does not have the required status.\n\n"
            f"**Remedy:** {gate_remedy}"
        )

    # Gate passed — allow the tool call
    sys.exit(0)


def deny(tool_name: str, file_path: str, reason: str):
    """Emit a PreToolUse deny decision and exit."""
    target = f" on `{file_path}`" if file_path else ""
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
