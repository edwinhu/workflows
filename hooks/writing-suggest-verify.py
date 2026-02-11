#!/usr/bin/env python3
"""
PostToolUse hook: Suggest /writing-revise after N edits in writing workflow.

Only fires for Edit/Write on .md files when an active writing workflow exists.
Tracks edit count in ACTIVE_WORKFLOW.md and suggests edit loop at threshold.
"""
import json
import os
import re
import sys
from pathlib import Path


def parse_yaml_value(content: str, key: str, default=None):
    """Extract a single value from YAML-like content."""
    pattern = rf'^{key}:\s*(.+)$'
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return match.group(1).strip().strip('"').strip("'")
    return default


def update_yaml_value(content: str, key: str, new_value) -> str:
    """Update a single value in YAML-like content."""
    pattern = rf'^({key}:\s*)(.+)$'
    replacement = rf'\g<1>{new_value}'
    new_content, count = re.subn(pattern, replacement, content, flags=re.MULTILINE)
    if count == 0:
        # Key doesn't exist, add it after the opening ---
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if line.strip() == '---' and i > 0:
                # Found the closing ---, insert before it
                lines.insert(i, f'{key}: {new_value}')
                return '\n'.join(lines)
        # No closing --- found, append to end
        return content + f'\n{key}: {new_value}'
    return new_content


def main():
    # Read tool input
    tool_input_str = os.environ.get('CLAUDE_TOOL_INPUT', '{}')
    try:
        tool_input = json.loads(tool_input_str)
    except json.JSONDecodeError:
        tool_input = {}

    file_path = tool_input.get('file_path', '')

    # Only process markdown files
    if not file_path.endswith('.md'):
        print(json.dumps({"result": "continue"}))
        return

    # Check for active writing workflow
    workflow_path = Path.cwd() / '.claude' / 'ACTIVE_WORKFLOW.md'
    if not workflow_path.exists():
        print(json.dumps({"result": "continue"}))
        return

    try:
        content = workflow_path.read_text()
    except Exception:
        print(json.dumps({"result": "continue"}))
        return

    # Check if this is a writing workflow
    workflow_type = parse_yaml_value(content, 'workflow')
    if workflow_type != 'writing':
        print(json.dumps({"result": "continue"}))
        return

    # Get current edit count and threshold
    edits = int(parse_yaml_value(content, 'edits_since_verify', '0'))
    threshold = int(parse_yaml_value(content, 'verify_threshold', '10'))

    # Increment edit count
    edits += 1

    if edits >= threshold:
        # Reset counter and suggest verification
        new_content = update_yaml_value(content, 'edits_since_verify', '0')
        workflow_path.write_text(new_content)

        style = parse_yaml_value(content, 'style', 'general')
        phase = parse_yaml_value(content, 'phase', 'edit')

        print(json.dumps({
            "result": "continue",
            "message": f"📝 {edits} edits since last verify (style: {style}, phase: {phase}). Consider `/writing-revise` to apply fixes and polish."
        }))
    else:
        # Just increment counter
        new_content = update_yaml_value(content, 'edits_since_verify', str(edits))
        workflow_path.write_text(new_content)
        print(json.dumps({"result": "continue"}))


if __name__ == '__main__':
    main()
