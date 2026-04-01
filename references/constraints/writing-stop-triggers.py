#!/usr/bin/env python3
"""Constraint: writing-stop-triggers — verify prose-producing skills load this constraint."""

CONSTRAINT = "writing-stop-triggers"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "hard"

import re
from pathlib import Path

# Skills that produce or modify prose must load stop triggers
PROSE_SKILLS = ['writing-draft', 'writing-review', 'writing-revise']
CONSTRAINT_PATTERN = re.compile(r'writing-stop-triggers\.md')


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        return violations

    for skill_name in PROSE_SKILLS:
        skill_file = skills_dir / skill_name / 'SKILL.md'
        if not skill_file.exists():
            continue

        text = skill_file.read_text()
        if not CONSTRAINT_PATTERN.search(text):
            violations.append(
                f"{skill_name}/SKILL.md does not reference writing-stop-triggers.md — "
                "prose-producing skills must load stop trigger patterns"
            )

    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
