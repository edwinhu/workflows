#!/usr/bin/env -S uv run python3
"""Constraint: topic-change-protocol — verify workflow skills load this constraint."""

CONSTRAINT = "topic-change-protocol"
APPLIES_TO = ["writing-setup", "writing-outline", "writing-draft",
              "writing-validate", "writing-review", "writing-revise"]
SEVERITY = "hard"

import re
from pathlib import Path

# All workflow phase skills (except entry router) must load this
PHASE_SKILLS = ['writing-setup', 'writing-outline', 'writing-draft',
                'writing-validate', 'writing-review', 'writing-revise']
CONSTRAINT_PATTERN = re.compile(r'topic-change-protocol\.md')


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        return violations

    for skill_name in PHASE_SKILLS:
        skill_file = skills_dir / skill_name / 'SKILL.md'
        if not skill_file.exists():
            continue

        text = skill_file.read_text()
        if not CONSTRAINT_PATTERN.search(text):
            violations.append(
                f"{skill_name}/SKILL.md does not reference topic-change-protocol.md — "
                "workflow phases must handle off-topic messages gracefully"
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
