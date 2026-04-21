#!/usr/bin/env -S uv run python3
"""Constraint: deviation-rules — every section summary must include deviation tracking."""
import re
import sys
from pathlib import Path

CONSTRAINT = "deviation-rules"
APPLIES_TO = ["writing-outline", "writing-draft", "writing-revise"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    # Check outline files for deviation tracking
    outlines_dir = cwd / "outlines"
    drafts_dir = cwd / "drafts"

    # Check outlines for deviation tracking
    if outlines_dir.is_dir():
        for outline_file in sorted(outlines_dir.glob("*.md")):
            content = outline_file.read_text()
            # Look for deviation tracking patterns
            has_deviation_line = bool(
                re.search(r"[Dd]eviation", content)
                or re.search(r"\bR[1-4]\b", content)
                or re.search(r"deviations?:\s*(none|0|\d)", content, re.IGNORECASE)
            )
            if not has_deviation_line and len(content) > 200:
                violations.append(
                    f"outlines/{outline_file.name} has no deviation tracking — "
                    "every section summary MUST include: "
                    "'Deviations: N auto-fixed (R1: X, R2: Y, R3: Z). R4 escalations: [list or none]'"
                )

    # Check draft files for deviation tracking
    if drafts_dir.is_dir():
        for draft_file in sorted(drafts_dir.glob("*.md")):
            content = draft_file.read_text()
            has_deviation_line = bool(
                re.search(r"[Dd]eviation", content)
                or re.search(r"\bR[1-4]\b", content)
                or re.search(r"deviations?:\s*(none|0|\d)", content, re.IGNORECASE)
            )
            if not has_deviation_line and len(content) > 200:
                violations.append(
                    f"drafts/{draft_file.name} has no deviation tracking — "
                    "every drafted section MUST include deviation tracking"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
