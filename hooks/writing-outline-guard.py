#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Warn when writing to drafts/ without matching outline in outlines/.

Scoped to writing-draft skill. Warns (doesn't block) when prose is written
without a matching outline — the Iron Law in the prompt handles hard enforcement.
"""

import json
import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HOOKS_DIR))
from _gate_common import deny  # noqa: E402


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    if tool_name != 'Write':
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    p = Path(file_path)

    # Check if writing to a drafts/ directory
    parts = p.parts
    try:
        drafts_idx = parts.index('drafts')
    except ValueError:
        sys.exit(0)  # Not a drafts/ file, allow

    # Extract the section name from the filename
    # Convention: drafts/[Section] (Draft).md or drafts/[Section].md
    stem = p.stem
    # Strip " (Draft)" suffix if present
    section_name = stem.replace(' (Draft)', '').replace(' (draft)', '').strip()

    if not section_name:
        sys.exit(0)  # Can't determine section, allow

    # Look for matching outline in outlines/ directory
    # outlines/ should be a sibling of drafts/
    drafts_parent = Path(*parts[:drafts_idx]) if drafts_idx > 0 else Path('.')
    outlines_dir = drafts_parent / 'outlines'

    # Check for outline with various naming patterns
    outline_found = False
    if outlines_dir.exists():
        for outline_file in outlines_dir.iterdir():
            outline_stem = outline_file.stem.strip()
            if outline_stem.lower() == section_name.lower():
                outline_found = True
                break

    if outline_found:
        sys.exit(0)  # Outline exists, allow

    # Hard block — NO PROSE WITHOUT OUTLINE (Iron Law enforcement).
    #
    # This used to be `print(..., file=sys.stderr); sys.exit(1)`, which does NOT block:
    # on PreToolUse only exit code 2 blocks the tool call, and every other non-zero code
    # is a "non-blocking error". The Write went through and the message never reached
    # Claude. The contract-correct hard stop is permissionDecision "deny".
    deny(
        f"BLOCKED: No outline found for this draft.\n\n"
        f"Writing to `{file_path}` but no matching outline in `{outlines_dir}/`.\n"
        f"Expected: `{outlines_dir}/{section_name}.md`\n\n"
        f"Create the outline first. Prose without structure produces wandering drafts "
        f"that require full rewrites — that's anti-helpful, not efficient."
    )


if __name__ == '__main__':
    main()
