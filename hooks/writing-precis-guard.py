#!/usr/bin/env -S uv run python3
"""
PostToolUse hook: Verify PRECIS.md has required sections after Write.

Fires after Write to .planning/PRECIS.md. Checks that all required sections
(Thesis, Key Claims with CLAIM-XX IDs, Audience, Scope) are present.
"""
import json
import os
import re
import sys
from pathlib import Path

REQUIRED_SECTIONS = {
    'thesis': re.compile(r'(?:^|\n)#+\s*thesis|(?:^|\n)\*\*thesis', re.IGNORECASE),
    'claims': re.compile(r'CLAIM-\d+'),
    'audience': re.compile(r'(?:^|\n)#+\s*audience|(?:^|\n)\*\*audience', re.IGNORECASE),
}


def main():
    tool_input_str = os.environ.get('CLAUDE_TOOL_INPUT', '{}')
    try:
        tool_input = json.loads(tool_input_str)
    except json.JSONDecodeError:
        print(json.dumps({"result": "continue"}))
        return

    file_path = tool_input.get('file_path', '')
    if not file_path:
        print(json.dumps({"result": "continue"}))
        return

    # Only check PRECIS.md writes
    p = Path(file_path)
    if p.name != 'PRECIS.md' or '.planning' not in str(p):
        print(json.dumps({"result": "continue"}))
        return

    if not p.exists():
        print(json.dumps({"result": "continue"}))
        return

    try:
        content = p.read_text()
    except Exception:
        print(json.dumps({"result": "continue"}))
        return

    missing = []
    for section, pattern in REQUIRED_SECTIONS.items():
        if not pattern.search(content):
            missing.append(section)

    if missing:
        print(json.dumps({
            "result": "continue",
            "message": (
                f"PRECIS.md is missing required sections: {', '.join(missing)}\n"
                f"A complete PRECIS needs: Thesis (main argument), "
                f"Key Claims (with CLAIM-XX IDs), and Audience.\n"
                f"Add the missing sections before proceeding to outline."
            )
        }))
    else:
        print(json.dumps({"result": "continue"}))


if __name__ == '__main__':
    main()
