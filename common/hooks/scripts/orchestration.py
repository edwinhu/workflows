#!/usr/bin/env python3
"""
Orchestration Hook: Consolidated PreToolUse hook for workflow management.

Combines:
- skill-activator: Activates workflow modes when /dev, /ds, /writing invoked
- main-chat-sandbox: Blocks main chat from editing when dev/ds mode active
- ralph-validate: Validates ralph-loop args, blocks nested loops, enforces skill gate

This hook ALWAYS runs (not workflow-gated) because it controls workflow activation.
"""

from __future__ import annotations

import json
import sys
import os
import re
import glob
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from session import (
    activate_dev_mode, activate_workflow, is_dev_mode_active,
    is_skill_gate_open, close_skill_gate, is_ralph_loop_active
)

# =============================================================================
# Skill Activator Logic
# =============================================================================

SKILL_TO_WORKFLOW = {
    'dev': 'dev', 'dev:start': 'dev', 'dev:dev': 'dev',
    'dev:dev-implement': 'dev', 'dev:dev-debug': 'dev',
    'dev:dev-brainstorm': 'dev', 'dev:dev-plan': 'dev',
    'dev:dev-review': 'dev', 'dev:dev-verify': 'dev',
    'ds': 'ds', 'ds:start': 'ds', 'ds:ds': 'ds',
    'ds:ds-implement': 'ds', 'ds:ds-brainstorm': 'ds',
    'ds:ds-plan': 'ds', 'ds:ds-review': 'ds',
    'writing': 'writing', 'writing-brainstorm': 'writing',
    'writing-econ': 'writing', 'writing-legal': 'writing',
}


def get_workflow_for_skill(skill: str) -> Optional[str]:
    """Determine which workflow a skill belongs to."""
    if skill in SKILL_TO_WORKFLOW:
        return SKILL_TO_WORKFLOW[skill]
    if skill.startswith('dev:') or skill.startswith('dev-'):
        return 'dev'
    if skill.startswith('ds:') or skill.startswith('ds-'):
        return 'ds'
    if skill.startswith('writing'):
        return 'writing'
    return None


def handle_skill_activation(skill: str) -> Optional[dict]:
    """Activate workflow if skill triggers it. Returns notification or None."""
    workflow = get_workflow_for_skill(skill)
    if workflow:
        activate_workflow(workflow)
        if workflow in ('dev', 'ds'):
            activate_dev_mode()
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "notification": f"✓ {workflow.upper()} workflow activated"
            }
        }
    return None


# =============================================================================
# Ralph Validate Logic
# =============================================================================

def validate_ralph_args(args: str) -> list:
    """Check ralph-loop arguments for required flags."""
    errors = []
    if '--completion-promise' not in args:
        errors.append('Missing --completion-promise (required for loop termination)')
    if '--max-iterations' not in args:
        errors.append('Missing --max-iterations (recommended: 15-30)')
    return errors


def check_ralph_validation(tool_name: str, tool_input: dict) -> Optional[dict]:
    """Validate ralph-loop invocations. Returns denial or None."""
    if tool_name == 'Skill':
        skill = tool_input.get('skill', '')
        args = tool_input.get('args', '')

        # Block dev-* skills unless gate is open
        if re.match(r'^dev[-_]', skill):
            if not is_skill_gate_open():
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"""⛔ Skill Gate Closed: Cannot invoke /{skill}

Orchestration skills (dev-*) can only be invoked from main chat.
Task agents must NOT invoke these skills.

If you ARE main chat and see this error, open the skill gate first.

Task agents should do work directly, not invoke orchestration skills."""
                    }
                }
            close_skill_gate()

        # Block nested ralph-loop (but not dev-ralph-loop documentation skill)
        if 'ralph-loop' in skill and 'dev-ralph-loop' not in skill:
            if is_ralph_loop_active():
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": """⛔ Nested Loop Blocked: Ralph loop is already active

You cannot start a ralph-loop inside another ralph-loop.
The current loop must complete first."""
                    }
                }

            errors = validate_ralph_args(args)
            if errors:
                return {
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
                }

    elif tool_name == 'Bash':
        command = tool_input.get('command', '')
        if 'ralph-loop' in command:
            if is_ralph_loop_active():
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": """⛔ Nested Loop Blocked: Ralph loop is already active

You cannot start a ralph-loop inside another ralph-loop."""
                    }
                }

            errors = validate_ralph_args(command)
            if errors:
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"""⛔ Ralph Validate: Invalid ralph-loop invocation

Errors:
{chr(10).join('• ' + e for e in errors)}

REQUIRED FORMAT:
/ralph-loop "task description" --max-iterations 30 --completion-promise 'DONE'"""
                    }
                }

    return None


# =============================================================================
# Main Chat Sandbox Logic
# =============================================================================

def is_from_agent(hook_input: dict) -> bool:
    """Check if this is from a sub-agent."""
    tool_use_id = hook_input.get('tool_use_id', '')
    if not tool_use_id:
        return False

    transcript_dirs = glob.glob(os.path.expanduser('~/.claude/projects/-home-*'))
    for dir_path in transcript_dirs:
        agent_files = glob.glob(os.path.join(dir_path, 'agent-*.jsonl'))
        for agent_file in agent_files:
            try:
                with open(agent_file, 'r') as f:
                    if tool_use_id in f.read():
                        return True
            except Exception:
                pass
    return False


def check_main_chat_sandbox(tool_name: str, tool_input: dict, hook_input: dict) -> Optional[dict]:
    """Enforce main chat sandbox when dev/ds mode active. Returns denial or None."""
    # Only enforce if dev/ds mode is active
    if not is_dev_mode_active():
        return None

    # Always allow from sub-agents
    if is_from_agent(hook_input):
        return None

    # Block Bash except safe read-only commands
    if tool_name == 'Bash':
        command = tool_input.get('command', '')

        dangerous_patterns = [';', '&&', '||', '|', '`', '$(', '${', '\n', '<(', '>(']
        has_dangerous_chars = any(p in command for p in dangerous_patterns)

        safe_prefixes = [
            'ls', 'cat', 'head', 'tail', 'grep', 'find', 'tree', 'pwd', 'echo',
            'git status', 'git log', 'git diff', 'git show', 'git branch',
            'git add', 'git commit', 'git push', 'git pull', 'git fetch',
            'git checkout', 'git stash', 'rg ', 'fd '
        ]
        is_safe = (
            not has_dangerous_chars and
            any(command.strip().startswith(prefix) for prefix in safe_prefixes)
        )

        if not is_safe:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": """Main Chat Sandbox: Bash blocked.

Main chat can only run read-only commands (ls, cat, grep, git status, etc.)
For modifications, delegate to sub-agents via Task tool.

Main chat orchestrates. Sub-agents execute.

To exit workflow mode: /dev:exit or /ds:exit"""
                }
            }

    # Block Write/Edit except for .md and .txt
    if tool_name in ('Write', 'Edit'):
        file_path = tool_input.get('file_path', '')
        allowed_extensions = ('.md', '.txt')

        resolved_path = os.path.realpath(file_path)
        path_parts = resolved_path.split(os.sep)
        is_in_claude_dir = '.claude' in path_parts

        is_allowed = (
            file_path.endswith(allowed_extensions) or
            is_in_claude_dir
        )

        if not is_allowed:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"""Main Chat Sandbox: Cannot write to {file_path}

Main chat can only write .md and .txt files.
For code changes, delegate to sub-agents via Task tool.

Main chat orchestrates. Sub-agents execute.

To exit workflow mode: /dev:exit or /ds:exit"""
                }
            }

    return None


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # 1. Check skill activation (Skill tool only)
    if tool_name == 'Skill':
        skill = tool_input.get('skill', '')
        notification = handle_skill_activation(skill)
        if notification:
            print(json.dumps(notification))
            # Don't exit - continue to other checks

    # 2. Check ralph validation (Skill or Bash)
    denial = check_ralph_validation(tool_name, tool_input)
    if denial:
        print(json.dumps(denial))
        sys.exit(0)

    # 3. Check main chat sandbox (Bash, Write, Edit)
    denial = check_main_chat_sandbox(tool_name, tool_input, hook_input)
    if denial:
        print(json.dumps(denial))
        sys.exit(0)

    # All checks passed
    sys.exit(0)


if __name__ == '__main__':
    main()
