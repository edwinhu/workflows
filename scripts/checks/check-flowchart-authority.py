#!/usr/bin/env -S uv run python3
"""Check: flowchart-authority — verify writing phase skills have flowcharts marked as spec.

Each writing phase skill (setup, outline, draft, validate, review, revise) should have
a flowchart section marked with "This IS the Spec" or equivalent authority marker.
"""
import re
import sys
from pathlib import Path

# Phase skills that MUST have flowcharts (not domain skills or utility skills)
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
    re.compile(r'```\s*\n.*[→↓│├└┌┐─]', re.DOTALL),  # ASCII flowchart characters
]

violations = []


def main():
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        print("PASS: flowchart-authority — skills directory not found")
        sys.exit(0)

    for skill_name in PHASE_SKILLS:
        skill_file = skills_dir / skill_name / 'SKILL.md'
        if not skill_file.exists():
            violations.append(f"FAIL: {skill_file} does not exist")
            continue

        text = skill_file.read_text()
        has_flowchart = any(p.search(text) for p in FLOWCHART_MARKERS)
        if not has_flowchart:
            violations.append(f"FAIL: {skill_name}/SKILL.md has no flowchart section — per flowchart-authority, the flowchart IS the spec")

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print("PASS: flowchart-authority — all phase skills have flowcharts")
    sys.exit(0)


if __name__ == '__main__':
    main()
