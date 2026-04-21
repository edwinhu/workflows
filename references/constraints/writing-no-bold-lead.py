#!/usr/bin/env -S uv run python3
"""Constraint: writing-no-bold-lead — no bold inline-header paragraph starts in prose drafts."""
import re
import sys
from pathlib import Path

CONSTRAINT = "writing-no-bold-lead"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "hard"

_BOLD_LEAD = re.compile(r'^\*\*[A-Z][^*]+[.?:]\*\*\s+\S')


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        lines = md_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if _BOLD_LEAD.match(stripped):
                label = re.match(r'\*\*([^*]+)\*\*', stripped)
                label_text = label.group(1) if label else stripped[:40]
                violations.append(
                    f"drafts/{md_file.name}:{i}: bold-lead pattern "
                    f"'**{label_text}**' — use prose topic sentence or *italic* label"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
