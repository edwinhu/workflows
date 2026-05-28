#!/usr/bin/env -S uv run python3
"""Constraint: wc-principle-ids — Mode 2 principles must have P01-P21 (+ P19b) formal IDs."""

CONSTRAINT = "wc-principle-ids"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "hard"

import re
import sys
from pathlib import Path


def check(context):
    """Check that Mode 2 Step 2 has formal P01-P21 (+ P19b) principle IDs."""
    violations = []
    cwd = Path(context.get("cwd", "."))

    skill_file = cwd / "skills" / "workflow-creator" / "SKILL.md"
    if not skill_file.exists():
        return violations

    content = skill_file.read_text()

    # Find Mode 2 section
    mode2_match = re.search(r'## Mode 2:', content)
    if not mode2_match:
        violations.append("Mode 2 section not found in SKILL.md")
        return violations

    mode2_content = content[mode2_match.start():]

    # Check for P01 through P21 plus the half-step P19b (matches the SKILL.md scoring set).
    expected_ids = [f"P{i:02d}" for i in range(1, 22)] + ["P19b"]
    # Capture both P\d\d and the P19b half-step token.
    found_ids = set(re.findall(r'\bP\d{2}b?\b', mode2_content))

    missing = [pid for pid in expected_ids if pid not in found_ids]
    if missing:
        violations.append(
            f"Mode 2 missing principle IDs: {', '.join(missing[:5])}{'...' if len(missing) > 5 else ''}"
        )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
