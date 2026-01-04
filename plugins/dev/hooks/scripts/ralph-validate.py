#!/usr/bin/env python3
"""
Ralph Validate: PreToolUse hook for workflow enforcement.
- Blocks ralph-loop calls missing --completion-promise
- Blocks dev-* skill invocations unless gate marker exists (main chat only)
- Blocks nested ralph-loop invocations

Session-aware: Uses session-specific state files.
"""

import json
import sys
import os
import re

# Add shared scripts to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shared'))
from session import is_skill_gate_open, close_skill_gate, is_ralph_loop_active


def validate_ralph_args(args: str) -> list:
    """Check ralph-loop arguments for required flags."""
    errors = []
    if '--completion-promise' not in args:
        errors.append('Missing --completion-promise (required for loop termination)')
    if '--max-iterations' not in args:
        errors.append('Missing --max-iterations (recommended: 15-30)')
    return errors


def main():
    try:
        hook_input = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Check Skill tool invocations
    if tool_name == 'Skill':
        skill = tool_input.get('skill', '')
        args = tool_input.get('args', '')

        # Block dev-* skills unless gate is open (main chat created marker)
        if re.match(r'^dev[-_]', skill):
            if not is_skill_gate_open():
                print(json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"""⛔ Skill Gate Closed: Cannot invoke /{skill}

Orchestration skills (dev-*) can only be invoked from main chat.
Task agents must NOT invoke these skills.

If you ARE main chat and see this error, open the skill gate first.

Task agents should do work directly, not invoke orchestration skills."""
                    }
                }))
                sys.exit(0)
            # Gate is open - close it immediately so sub-agents can't use it
            close_skill_gate()

        # Block nested ralph-loop invocations
        if 'ralph-loop' in skill:
            if is_ralph_loop_active():
                print(json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": """⛔ Nested Loop Blocked: Ralph loop is already active

You cannot start a ralph-loop inside another ralph-loop.
The current loop must complete first.

If you need to debug/implement something, do it directly -
you're already inside an iterative loop."""
                    }
                }))
                sys.exit(0)

            # Validate ralph-loop args
            errors = validate_ralph_args(args)
            if errors:
                print(json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"""⛔ Ralph Validate: Invalid ralph-loop invocation

Errors:
{chr(10).join('• ' + e for e in errors)}

REQUIRED FORMAT:
/ralph-loop "task description" --max-iterations 30 --completion-promise "DONE"

The --completion-promise flag is MANDATORY. Without it, ralph loops infinitely."""
                    }
                }))
                sys.exit(0)

    # Also check Bash commands that might invoke ralph-loop
    elif tool_name == 'Bash':
        command = tool_input.get('command', '')
        if '/ralph-loop' in command or 'ralph-loop' in command:
            if is_ralph_loop_active():
                print(json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": """⛔ Nested Loop Blocked: Ralph loop is already active

You cannot start a ralph-loop inside another ralph-loop."""
                    }
                }))
                sys.exit(0)

            errors = validate_ralph_args(command)
            if errors:
                print(json.dumps({
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"""⛔ Ralph Validate: Invalid ralph-loop invocation

Errors:
{chr(10).join('• ' + e for e in errors)}

REQUIRED FORMAT:
/ralph-loop "task description" --max-iterations 30 --completion-promise 'DONE'"""
                    }
                }))
                sys.exit(0)

    # No issues found
    sys.exit(0)


if __name__ == '__main__':
    main()
