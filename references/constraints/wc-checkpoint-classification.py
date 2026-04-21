#!/usr/bin/env -S uv run python3
"""Constraint: wc-checkpoint-classification — all gates must have checkpoint type annotations."""

CONSTRAINT = "wc-checkpoint-classification"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "soft"

import re
import sys
from pathlib import Path


def check(context):
    """Check that every Gate: section has a [checkpoint: TYPE] annotation."""
    violations = []
    cwd = Path(context.get("cwd", "."))

    skill_file = cwd / "skills" / "workflow-creator" / "SKILL.md"
    if not skill_file.exists():
        return violations

    content = skill_file.read_text()
    lines = content.split("\n")

    for i, line in enumerate(lines):
        if re.match(r'\*\*Gate:', line):
            if '[checkpoint:' not in line:
                violations.append(
                    f"Line {i+1}: Gate without checkpoint classification: {line.strip()[:80]}"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
