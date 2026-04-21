#!/usr/bin/env -S uv run python3
"""Constraint: post-subagent-enforcement — verify skills that use subagents load this constraint."""

CONSTRAINT = "post-subagent-enforcement"
APPLIES_TO = ["writing-review", "writing-revise"]
SEVERITY = "hard"

import re
from pathlib import Path

# Skills that dispatch subagents must load this constraint
SUBAGENT_SKILLS = ['writing-review', 'writing-revise']
CONSTRAINT_PATTERN = re.compile(r'post-subagent-enforcement\.md')


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        return violations

    for skill_name in SUBAGENT_SKILLS:
        skill_file = skills_dir / skill_name / 'SKILL.md'
        if not skill_file.exists():
            continue

        text = skill_file.read_text()
        if not CONSTRAINT_PATTERN.search(text):
            violations.append(
                f"{skill_name}/SKILL.md does not reference post-subagent-enforcement.md — "
                "skills that dispatch subagents must load post-subagent boundaries"
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
