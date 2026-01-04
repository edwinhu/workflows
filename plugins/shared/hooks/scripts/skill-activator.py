#!/usr/bin/env python3
"""
Skill Activator: Auto-activate sandbox when /dev or /ds skills are invoked.
"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session import activate_dev_mode, get_session_id


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

    # Auto-activate for dev or ds main skills
    if skill in ('dev', 'ds'):
        activate_dev_mode()
        # Output a message that will be shown to the user
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "notification": f"✓ {skill.upper()} mode activated"
            }
        }))

    sys.exit(0)


if __name__ == '__main__':
    main()
