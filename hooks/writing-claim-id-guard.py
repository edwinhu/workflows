#!/usr/bin/env -S uv run python3
"""
PostToolUse hook: enforce CLAIM-XX traceability on written outline/draft files.

Claims must be traceable through every artifact so the deterministic section index
(scripts/writing/writing_section_index.py) can resolve each section's claims and run the ⊇
gate (draft.implements ⊇ the OUTLINE.md Claim→Section Map's primary claims).

Enforcement is SCOPED to avoid false positives on incremental work (the in-flight-project
risk flagged in DESIGN D-w-3):
  - drafts/  → BLOCK on zero CLAIM-XX. A finished prose draft with no claim trace cannot be
    indexed and would fail the ⊇ gate anyway; drafts are not built point-by-point.
  - outlines/ → WARN only. Outlines are written subsection-by-subsection; the COMPREHENSIVE
    hard gate is hooks/writing-outline-executable-guard.py (PreToolUse on OUTLINE_REVIEWED.md).
Only enforced inside a writing PROJECT (a .planning/ dir present).
"""
import json
import os
import re
import sys
from pathlib import Path

CLAIM_PATTERN = re.compile(r'CLAIM-\d+')


def _in_writing_project(p: Path) -> bool:
    return any((parent / ".planning").is_dir() for parent in p.parents)


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

    p = Path(file_path)
    parts = p.parts

    # Only check outlines/ and drafts/ directories
    is_outline = 'outlines' in parts
    is_draft = 'drafts' in parts

    if not (is_outline or is_draft):
        print(json.dumps({"result": "continue"}))
        return

    # Check if the file exists and contains CLAIM-XX references
    if not p.exists():
        print(json.dumps({"result": "continue"}))
        return

    try:
        content = p.read_text()
    except Exception:
        print(json.dumps({"result": "continue"}))
        return

    claims = CLAIM_PATTERN.findall(content)
    artifact_type = "outline" if is_outline else "draft"

    if claims:
        print(json.dumps({"result": "continue"}))
        return

    remedy = (
        f"No CLAIM-XX IDs found in {artifact_type} file: {file_path}\n"
        f"Every {artifact_type} must reference the PRECIS claims it covers.\n"
        f"Add 'implements: [CLAIM-XX]' frontmatter (or a 'Claim Supported: CLAIM-XX' line)."
    )

    # A finished DRAFT with no claim trace is unambiguous → BLOCK (only inside a project).
    if is_draft and _in_writing_project(p):
        print(json.dumps({
            "decision": "block",
            "reason": remedy + (
                "\n\nThis draft cannot be indexed (its implements set is empty), so it would "
                "fail the section-index ⊇ gate (draft.implements must ⊇ the OUTLINE.md "
                "Claim → Section Map's primary claims for this section). Add the implements "
                "frontmatter, then continue."
            ),
        }))
        return

    # Outlines (or non-project files) → warn only; the outline-executable guard hard-gates at approval.
    print(json.dumps({"result": "continue", "message": remedy}))


if __name__ == '__main__':
    main()
