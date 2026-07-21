#!/usr/bin/env -S uv run python3
"""
PostToolUse hook: Suggest /writing-revise after N edits in writing workflow.

Only fires for Edit/Write on .md files when an active writing workflow exists.
Tracks edit count in ACTIVE_WORKFLOW.md and suggests edit loop at threshold.
"""
import json
import re
import sys
from pathlib import Path

# Hooks read their payload from STDIN -- CLAUDE_TOOL_INPUT does not exist -- and
# {"result": "continue"} is not part of the hook contract. This hook used both, so it
# saw an empty file_path on EVERY Edit/Write, took the early-return branch, and then
# emitted a payload the harness rejected outright ("Hook JSON output validation
# failed"). Net effect: the verify-nudge never fired and the edit counter never moved.
# Non-blocking feedback on PostToolUse is hookSpecificOutput.additionalContext;
# printing nothing is how a hook says "carry on".
HOOKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HOOKS_DIR))
from _gate_common import context  # noqa: E402


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
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if hook_input.get('tool_name', '') not in ('Write', 'Edit', 'MultiEdit'):
        sys.exit(0)

    tool_input = hook_input.get('tool_input', {}) or {}
    file_path = tool_input.get('file_path', '')

    # Only process markdown files
    if not file_path.endswith('.md'):
        sys.exit(0)

    # Check for active writing workflow
    workflow_path = Path.cwd() / '.planning' / 'ACTIVE_WORKFLOW.md'
    if not workflow_path.exists():
        sys.exit(0)

    try:
        content = workflow_path.read_text()
    except Exception:
        sys.exit(0)

    # Check if this is a writing workflow
    workflow_type = parse_yaml_value(content, 'workflow')
    if workflow_type != 'writing':
        sys.exit(0)

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

        context(
            'PostToolUse',
            f"📝 {edits} edits since last verify (style: {style}, phase: {phase}). "
            f"Consider `/writing-revise` to apply fixes and polish."
        )
    else:
        # Just increment counter
        new_content = update_yaml_value(content, 'edits_since_verify', str(edits))
        workflow_path.write_text(new_content)
        sys.exit(0)


if __name__ == '__main__':
    main()
