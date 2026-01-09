#!/usr/bin/env python3
"""
Marimo PostToolUse Hook: Validates marimo notebooks after Edit/Write operations.

Only triggers on files that contain 'import marimo' (actual marimo notebooks).
Runs `marimo check` to catch structural errors early.

Non-blocking: Reports issues as warnings, doesn't prevent edits.
"""

from __future__ import annotations

import json
import sys
import os
import subprocess
import re


def is_marimo_notebook(file_path: str) -> bool:
    """Check if file is a marimo notebook by looking for 'import marimo' and '@app.cell'.

    Uses the pattern from marimo docs: both patterns must be present.
    """
    if not file_path.endswith('.py'):
        return False

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            # Check for both import marimo and @app.cell decorator (marimo docs pattern)
            has_import = bool(re.search(r'^\s*import\s+marimo', content, re.MULTILINE))
            has_app_cell = '@app.cell' in content
            return has_import and has_app_cell
    except Exception:
        return False


def run_marimo_check(file_path: str) -> tuple[bool, str]:
    """Run marimo check on the notebook using uvx. Returns (success, output)."""
    try:
        result = subprocess.run(
            ['uvx', 'marimo', 'check', file_path],
            capture_output=True,
            text=True,
            timeout=30,  # uvx may need to fetch marimo first time
            cwd=os.path.dirname(file_path) or '.'
        )

        # marimo check exits 0 on success, non-zero on errors
        success = result.returncode == 0
        output = result.stdout + result.stderr

        return success, output.strip()
    except subprocess.TimeoutExpired:
        return False, "marimo check timed out (30s)"
    except FileNotFoundError:
        return False, "uvx command not found. Is uv installed? See: https://docs.astral.sh/uv/"
    except Exception as e:
        return False, f"Error running marimo check: {type(e).__name__}: {e}"


def format_marimo_errors(output: str) -> str:
    """Format marimo check errors for display."""
    if not output:
        return "marimo check reported errors but no details available"

    # Extract the most useful parts (skip verbose output)
    lines = output.split('\n')

    # Look for actual error messages (usually after "Error:" or contain "cell")
    errors = []
    for line in lines:
        if any(keyword in line.lower() for keyword in ['error', 'warning', 'cell', 'variable', 'undefined', 'multiple', 'circular']):
            errors.append(line)

    if errors:
        return '\n'.join(errors)

    # Fall back to full output if no specific errors found
    return output[:500]  # Limit length


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Only check Edit and Write tools
    if tool_name not in ('Edit', 'Write'):
        sys.exit(0)

    # Get file path from tool input
    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Check if it's a marimo notebook
    if not is_marimo_notebook(file_path):
        sys.exit(0)

    # Run marimo check
    success, output = run_marimo_check(file_path)

    if success:
        # Optional: Could show success message, but staying quiet is less intrusive
        # result = {
        #     "hookSpecificOutput": {
        #         "hookEventName": "PostToolUse",
        #         "message": f"✓ marimo check passed: {os.path.basename(file_path)}"
        #     }
        # }
        # print(json.dumps(result))
        sys.exit(0)
    else:
        # Report issues as warning (non-blocking)
        errors = format_marimo_errors(output)
        result = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "message": f"⚠️ marimo check found issues in {os.path.basename(file_path)}:\n\n{errors}\n\nFix these before running the notebook."
            }
        }
        print(json.dumps(result))
        sys.exit(0)


if __name__ == '__main__':
    main()
