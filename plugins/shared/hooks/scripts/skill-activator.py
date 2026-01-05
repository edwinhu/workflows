#!/usr/bin/env python3
"""
Skill Activator: Auto-activate workflow when /dev, /ds, or /writing skills are invoked.

This makes hooks session-aware - they only run when their workflow is active,
similar to how Ralph Wiggum loops work with is_ralph_loop_active().
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session import activate_dev_mode, activate_workflow, get_session_id

# Map skill names/prefixes to workflows
SKILL_TO_WORKFLOW = {
    'dev': 'dev',
    'dev:start': 'dev',
    'dev:dev': 'dev',
    'dev:dev-implement': 'dev',
    'dev:dev-debug': 'dev',
    'dev:dev-brainstorm': 'dev',
    'dev:dev-plan': 'dev',
    'dev:dev-review': 'dev',
    'dev:dev-verify': 'dev',
    'ds': 'ds',
    'ds:start': 'ds',
    'ds:ds': 'ds',
    'ds:ds-implement': 'ds',
    'ds:ds-brainstorm': 'ds',
    'ds:ds-plan': 'ds',
    'ds:ds-review': 'ds',
    'writing': 'writing',
    'writing-brainstorm': 'writing',
    'writing-econ': 'writing',
    'writing-legal': 'writing',
}


def get_workflow_for_skill(skill: str) -> str | None:
    """Determine which workflow a skill belongs to."""
    # Exact match first
    if skill in SKILL_TO_WORKFLOW:
        return SKILL_TO_WORKFLOW[skill]

    # Prefix match for dev:* and ds:* skills
    if skill.startswith('dev:') or skill.startswith('dev-'):
        return 'dev'
    if skill.startswith('ds:') or skill.startswith('ds-'):
        return 'ds'
    if skill.startswith('writing'):
        return 'writing'

    return None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name != 'Skill':
        sys.exit(0)

    skill = tool_input.get('skill', '')

    # Determine workflow for this skill
    workflow = get_workflow_for_skill(skill)

    if workflow:
        # Activate workflow-specific marker (session-aware hooks)
        activate_workflow(workflow)

        # Also activate legacy dev_mode for backwards compatibility
        if workflow in ('dev', 'ds'):
            activate_dev_mode()

        # Output a message that will be shown to the user
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "notification": f"✓ {workflow.upper()} workflow activated"
            }
        }))

    sys.exit(0)


if __name__ == '__main__':
    main()
