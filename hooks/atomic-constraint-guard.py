#!/usr/bin/env -S uv run python3
"""PostToolUse hook: Guard against monolithic constraint files.

Fires on Write/Edit. Detects two anti-patterns:
1. Writing a .md file to references/ (not constraints/) that looks like bundled constraints
2. Writing a .md file to references/constraints/ with 3+ ### rule headings (monolith)

Non-blocking: reports as additional context so the agent can self-correct.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    path = Path(file_path)

    # Only check .md files
    if path.suffix.lower() != ".md":
        sys.exit(0)

    # Only check files under a references/ directory
    parts = path.parts
    if "references" not in parts:
        sys.exit(0)

    try:
        content = path.read_text()
    except Exception:
        sys.exit(0)

    messages = []

    # Find the references/ directory position
    ref_idx = len(parts) - 1 - list(reversed(parts)).index("references")

    # Check 1: File is directly in references/ (not in constraints/ subdirectory)
    # and has constraint-like content
    in_constraints_dir = (
        ref_idx + 1 < len(parts) and parts[ref_idx + 1] == "constraints"
    )

    if not in_constraints_dir:
        stem = path.stem
        h3_count = len(re.findall(r"^###\s+", content, re.MULTILINE))

        if (stem.endswith("-constraints") or stem.endswith("-conventions")) and h3_count >= 3:
            messages.append(
                f"MONOLITH DETECTED: {path.name} has {h3_count} sections and looks like bundled constraints. "
                f"Split into individual .md files in references/constraints/ — one rule per file. "
                f"See the atomic-constraints constraint for details."
            )

    # Check 2: File is in constraints/ but has too many ### headings
    if in_constraints_dir:
        h3_count = len(re.findall(r"^###\s+", content, re.MULTILINE))
        # Allow the meta-constraint itself to have structure
        if h3_count >= 3 and path.stem != "atomic-constraints":
            messages.append(
                f"POTENTIAL MONOLITH: {path.name} has {h3_count} ### headings. "
                f"Each constraint file should contain ONE rule. "
                f"If these headings describe different rules, split into separate files."
            )

    if not messages:
        sys.exit(0)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n".join(messages),
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
