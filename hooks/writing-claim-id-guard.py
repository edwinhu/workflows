#!/usr/bin/env python3
"""
PostToolUse hook: Check that written outline/draft files reference CLAIM-XX IDs.

Fires after Write to outlines/ or drafts/ directories. Warns if no CLAIM-XX IDs found
in the written content — claims must be traceable through all artifacts.
"""
import json
import os
import re
import sys
from pathlib import Path

CLAIM_PATTERN = re.compile(r'CLAIM-\d+')


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

    if not claims:
        print(json.dumps({
            "result": "continue",
            "message": (
                f"No CLAIM-XX IDs found in {artifact_type} file: {file_path}\n"
                f"Every {artifact_type} must reference the PRECIS claims it covers.\n"
                f"Add 'Implements: [CLAIM-XX]' or 'Claim Supported: CLAIM-XX' lines."
            )
        }))
    else:
        print(json.dumps({"result": "continue"}))


if __name__ == '__main__':
    main()
