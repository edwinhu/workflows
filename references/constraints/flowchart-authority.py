#!/usr/bin/env -S uv run python3
"""Constraint: flowchart-authority — verify writing phase skills have flowcharts marked as spec."""

CONSTRAINT = "flowchart-authority"
APPLIES_TO = ["writing-setup", "writing-outline", "writing-draft", "writing-validate", "writing-review", "writing-revise"]
SEVERITY = "hard"

import re
from pathlib import Path

PHASE_SKILLS = [
    'writing-setup',
    'writing-outline',
    'writing-draft',
    'writing-validate',
    'writing-review',
    'writing-revise',
]

FLOWCHART_MARKERS = [
    re.compile(r'this\s+IS\s+the\s+spec', re.IGNORECASE),
    re.compile(r'flowchart.*spec', re.IGNORECASE),
    re.compile(r'authoritative.*flowchart', re.IGNORECASE),
    re.compile(r'```\s*\n.*[→↓│├└┌┐─]', re.DOTALL),
]


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
            violations.append(f"{skill_file} does not exist")
            continue

        text = skill_file.read_text()
        has_flowchart = any(p.search(text) for p in FLOWCHART_MARKERS)
        if not has_flowchart:
            violations.append(f"{skill_name}/SKILL.md has no flowchart section — per flowchart-authority, the flowchart IS the spec")

    return violations


if __name__ == "__main__":
    import json, sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
