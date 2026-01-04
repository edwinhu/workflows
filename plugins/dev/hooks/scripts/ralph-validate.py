#!/usr/bin/env python3
"""
Ralph Validate: PreToolUse hook for workflow enforcement.
- Blocks ralph-loop calls missing --completion-promise
- Blocks dev-* skill invocations unless gate marker exists (main chat only)
- Blocks nested ralph-loop invocations
"""

import json
import sys
import os
import re

SKILL_GATE_FILE = '.claude/skill-gate.lock'

def validate_ralph_args(args: str) -> list:
    """Check ralph-loop arguments for required flags."""
    errors = []
    if '--completion-promise' not in args:
        errors.append('Missing --completion-promise (required for loop termination)')
    if '--max-iterations' not in args:
        errors.append('Missing --max-iterations (recommended: 15-30)')
    return errors

def is_ralph_loop_active() -> bool:
    """Check if a ralph loop is currently active."""
    state_file = '.claude/ralph-loop.local.md'
    if not os.path.exists(state_file):
        return False
    try:
        with open(state_file, 'r') as f:
            content = f.read()
            return 'active: true' in content
    except:
        return False

def is_skill_gate_open() -> bool:
    """Check if the skill gate marker exists (main chat context)."""
    return os.path.exists(SKILL_GATE_FILE)

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

If you ARE main chat and see this error:
1. Run: mkdir -p .claude && touch .claude/skill-gate.lock
2. Then invoke the skill

Task agents should do work directly, not invoke orchestration skills."""
                    }
                }))
                sys.exit(0)
            # Gate is open - delete it immediately so sub-agents can't use it
            try:
                os.remove(SKILL_GATE_FILE)
            except:
                pass

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
/ralph-loop "task description" --max-iterations 30 --completion-promise "DONE""""
                    }
                }))
                sys.exit(0)

    # No issues found
    sys.exit(0)

if __name__ == '__main__':
    main()
