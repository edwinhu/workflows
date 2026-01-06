#!/usr/bin/env python3
"""
Unified Hook Dispatcher: Single PreToolUse hook that handles all workflow checks.

Consolidates:
- Skill activation (activates workflow when /dev, /ds, /writing invoked)
- Sandbox enforcement (only when sandbox active)
- Ralph validation (only when ralph-loop invoked)
- Dev checks: grep-test-detector (only when dev workflow active)
- DS checks: data quality, reproducibility, output verification (only when ds workflow active)

Design: When no workflow is active, exits immediately with minimal overhead.
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
    is_dev_mode_active, is_workflow_active, activate_workflow, activate_dev_mode,
    is_skill_gate_open, close_skill_gate, is_ralph_loop_active
)


# =============================================================================
# Skill Activation
# =============================================================================

def get_workflow_for_skill(skill: str) -> Optional[str]:
    """Determine which workflow a skill belongs to."""
    # Exit skills don't activate workflows
    if 'exit' in skill:
        return None
    # Sandbox skills don't activate workflows (they're manual control)
    if 'sandbox' in skill:
        return None

    if skill in ('dev', 'ds', 'writing'):
        return skill
    if skill.startswith('dev:') or skill.startswith('dev-'):
        return 'dev'
    if skill.startswith('ds:') or skill.startswith('ds-'):
        return 'ds'
    if skill.startswith('writing'):
        return 'writing'
    return None


def handle_skill_activation(skill: str) -> Optional[dict]:
    """Activate workflow when skill is invoked. Returns notification or None."""
    workflow = get_workflow_for_skill(skill)
    if workflow:
        activate_workflow(workflow)
        if workflow in ('dev', 'ds'):
            activate_dev_mode()  # Enable sandbox
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "notification": f"✓ {workflow.upper()} workflow activated"
            }
        }
    return None


# =============================================================================
# Early Exit Check
# =============================================================================

def should_run_checks(tool_name: str, tool_input: dict) -> bool:
    """Determine if we need to run any checks at all."""
    # Always check ralph-loop invocations (regardless of workflow state)
    if tool_name == 'Skill':
        skill = tool_input.get('skill', '')
        if 'ralph-loop' in skill or re.match(r'^dev[-_]', skill):
            return True
    if tool_name == 'Bash' and 'ralph-loop' in tool_input.get('command', ''):
        return True

    # Check if any workflow/sandbox is active
    if is_dev_mode_active():
        return True
    if is_workflow_active('dev'):
        return True
    if is_workflow_active('ds'):
        return True

    # Nothing active, nothing to check
    return False


# =============================================================================
# Ralph Validation
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
    """Validate ralph-loop invocations and skill gates."""
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
                        "permissionDecisionReason": f"⛔ Skill Gate Closed: Cannot invoke /{skill}\n\nOrchestration skills (dev-*) can only be invoked from main chat."
                    }
                }
            close_skill_gate()

        # Block nested ralph-loop
        if 'ralph-loop' in skill:
            if is_ralph_loop_active():
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": "⛔ Nested Loop Blocked: Ralph loop is already active"
                    }
                }
            errors = validate_ralph_args(args)
            if errors:
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"⛔ Ralph Validate: Missing required args\n\n" + "\n".join(f"• {e}" for e in errors)
                    }
                }

    elif tool_name == 'Bash':
        command = tool_input.get('command', '')
        # Only match actual ralph-loop script invocations, not mentions in file content
        if 'setup-ralph-loop.sh' in command:
            if is_ralph_loop_active():
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": "⛔ Nested Loop Blocked: Ralph loop is already active"
                    }
                }
            errors = validate_ralph_args(command)
            if errors:
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": f"⛔ Ralph Validate: Missing required args\n\n" + "\n".join(f"• {e}" for e in errors)
                    }
                }
    return None


# =============================================================================
# Sandbox (REMOVED - now guidance-based via skills)
# =============================================================================
#
# The sandbox blocking approach was removed because:
# 1. Agent detection was unreliable and caused bugs
# 2. Users bypassed it by exiting workflow mode
# 3. It treated the symptom (main chat writing) not the cause (skipping phases)
#
# The new approach uses:
# - dev-delegate / ds-delegate skills for subagent templates
# - REQUIRED SUB-SKILL handoffs to enforce workflow phases
# - Making delegation the obvious/easy path, not blocking the alternative
#
# See: skills/dev-delegate/SKILL.md, skills/ds-delegate/SKILL.md


def check_sandbox(tool_name: str, tool_input: dict, hook_input: dict) -> Optional[dict]:
    """Sandbox enforcement removed - now guidance-based via delegation skills."""
    # No blocking - workflow skills guide delegation instead
    return None


# =============================================================================
# Dev Checks (grep-test-detector)
# =============================================================================

SOURCE_EXTENSIONS = r'\.(c|h|cpp|hpp|py|js|ts|go|rs|java|rb|sh|bash)$'
LOG_PATTERNS = [r'/tmp/', r'\.log$', r'\.out$', r'\.err$', r'stderr', r'stdout', r'2>&1', r'\|']


def is_source_file_grep(grep_match: str) -> bool:
    if '|' in grep_match or '2>&1' in grep_match:
        return False
    for pattern in LOG_PATTERNS:
        if re.search(pattern, grep_match, re.IGNORECASE):
            return False
    return bool(re.search(SOURCE_EXTENSIONS, grep_match, re.IGNORECASE))


def check_dev_patterns(tool_name: str, tool_input: dict) -> Optional[dict]:
    """Check for dev anti-patterns (grep tests, skip=pass)."""
    if not is_workflow_active('dev'):
        return None

    content = ''
    if tool_name == 'Bash':
        content = tool_input.get('command', '')
    elif tool_name == 'Write':
        file_path = tool_input.get('file_path', '')
        if 'test' in file_path.lower():
            content = tool_input.get('content', '')

    if not content:
        return None

    # Check SKIP != PASS
    if re.search(r'SKIP.*PASS|PASS.*SKIP', content, re.IGNORECASE):
        if re.search(r'all.*pass|tests.*pass', content, re.IGNORECASE):
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "message": "⚠️ SKIP ≠ PASS: Skipped tests are not passing tests"
                }
            }

    # Check grep source files
    grep_commands = re.findall(r'grep[^|&\n]*', content)
    for grep_cmd in grep_commands:
        if is_source_file_grep(grep_cmd):
            if re.search(r'(PASS|FAIL|CHECK)', content, re.IGNORECASE):
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": "⚠️ Grep source anti-pattern: Run code and check logs, don't grep source files"
                    }
                }
    return None


# =============================================================================
# DS Checks (data quality, reproducibility, output verification)
# =============================================================================

def check_ds_patterns(tool_name: str, tool_input: dict) -> Optional[dict]:
    """Check for DS anti-patterns."""
    if not is_workflow_active('ds'):
        return None

    content = ''
    if tool_name == 'Bash':
        content = tool_input.get('command', '')
    elif tool_name == 'Write':
        content = tool_input.get('content', '')

    if not content:
        return None

    # Only check Python content
    is_python = any(x in content for x in ['python', 'pd.', 'pandas', 'DataFrame', 'np.', 'numpy'])
    if not is_python:
        return None

    warnings = []

    # Data quality checks
    df_patterns = [r'pd\.read_', r'pd\.DataFrame\s*\(', r'\.merge\s*\(', r'\.concat\s*\(']
    if any(re.search(p, content) for p in df_patterns):
        if not any(re.search(p, content) for p in [r'\.head\s*\(', r'\.info\s*\(', r'\.shape']):
            warnings.append("DataFrame without inspection (.head/.info/.shape)")
        if not any(re.search(p, content, re.IGNORECASE) for p in [r'\.isnull', r'\.isna', r'\.dropna']):
            warnings.append("No null check")

    # Reproducibility checks
    if any(re.search(p, content) for p in [r'np\.random\.', r'random\.']):
        if not re.search(r'seed\s*[=(]', content, re.IGNORECASE):
            warnings.append("Random ops without seed")

    if warnings:
        return {"decision": "approve", "reason": " | ".join(warnings)}
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

    # Skill activation (always check for Skill tool)
    if tool_name == 'Skill':
        skill = tool_input.get('skill', '')
        notification = handle_skill_activation(skill)
        if notification:
            print(json.dumps(notification))
            # Continue to other checks (don't exit)

    # FAST PATH: Exit immediately if nothing else to check
    if not should_run_checks(tool_name, tool_input):
        sys.exit(0)

    # Ralph validation (skill gates, nested loops)
    result = check_ralph_validation(tool_name, tool_input)
    if result:
        print(json.dumps(result))
        sys.exit(0)

    # Sandbox enforcement
    result = check_sandbox(tool_name, tool_input, hook_input)
    if result:
        print(json.dumps(result))
        sys.exit(0)

    # Dev workflow checks
    result = check_dev_patterns(tool_name, tool_input)
    if result:
        print(json.dumps(result))
        sys.exit(0)

    # DS workflow checks
    result = check_ds_patterns(tool_name, tool_input)
    if result:
        print(json.dumps(result))

    sys.exit(0)


if __name__ == '__main__':
    main()
