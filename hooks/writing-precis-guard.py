#!/usr/bin/env -S uv run python3
"""
PostToolUse hook: Verify PRECIS.md has required sections after Write.

Fires after Write to .planning/PRECIS.md. Checks that all required sections
(Thesis, Key Claims with CLAIM-XX IDs, Audience, Scope) are present.
"""
import json
import re
import sys
from pathlib import Path

# Hooks receive their payload as JSON on STDIN -- there is no CLAUDE_TOOL_INPUT env
# var, and there is no {"result": "continue"} in the hook contract. This hook used
# both, so it read an empty input on every call and then emitted a payload the harness
# rejected outright. Non-blocking feedback on PostToolUse goes through
# hookSpecificOutput.additionalContext; saying nothing is how a hook says "carry on".
HOOKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HOOKS_DIR))
from _gate_common import context  # noqa: E402

REQUIRED_SECTIONS = {
    'thesis': re.compile(r'(?:^|\n)#+\s*thesis|(?:^|\n)\*\*thesis', re.IGNORECASE),
    'claims': re.compile(r'CLAIM-\d+'),
    'audience': re.compile(r'(?:^|\n)#+\s*audience|(?:^|\n)\*\*audience', re.IGNORECASE),
}


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if hook_input.get('tool_name', '') not in ('Write', 'Edit', 'MultiEdit'):
        sys.exit(0)

    tool_input = hook_input.get('tool_input', {}) or {}
    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Only check PRECIS.md writes
    p = Path(file_path)
    if p.name != 'PRECIS.md' or '.planning' not in str(p):
        sys.exit(0)

    if not p.exists():
        sys.exit(0)

    try:
        content = p.read_text()
    except Exception:
        sys.exit(0)

    missing = []
    for section, pattern in REQUIRED_SECTIONS.items():
        if not pattern.search(content):
            missing.append(section)

    if missing:
        context('PostToolUse', (
            f"PRECIS.md is missing required sections: {', '.join(missing)}\n"
            f"A complete PRECIS needs: Thesis (main argument), "
            f"Key Claims (with CLAIM-XX IDs), and Audience.\n"
            f"Add the missing sections before proceeding to outline."
        ))
    sys.exit(0)


if __name__ == '__main__':
    main()
