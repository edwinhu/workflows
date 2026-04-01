#!/usr/bin/env python3
"""Constraint: no-pause-between-phases — verify writing skills don't contain pause patterns."""

CONSTRAINT = "no-pause-between-phases"
APPLIES_TO = ["all"]
SEVERITY = "hard"

import re
from pathlib import Path

PAUSE_PATTERNS = [
    (re.compile(r'should I continue\??', re.IGNORECASE), "asks permission to continue"),
    (re.compile(r'wait for (user |human )?confirmation', re.IGNORECASE), "waits for confirmation"),
    (re.compile(r'pause (for|and) (ask|wait|get)', re.IGNORECASE), "pauses for input"),
    (re.compile(r'ask.*before proceeding', re.IGNORECASE), "asks before proceeding"),
]

ALLOWED_CONTEXTS = [
    'decision', 'human-action', 'checkpoint_type', 'AskUserQuestion',
    'Do NOT', 'Do not', 'NOT:', 'NO ', 'NEVER',
    'feedback', 'Red Flag', 'Rationalization',
    'IMMEDIATELY proceed', 'IMMEDIATELY start',
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        return violations

    for skill_dir in sorted(skills_dir.iterdir()):
        if skill_dir.name.startswith('writing') and skill_dir.is_dir():
            skill_file = skill_dir / 'SKILL.md'
            if not skill_file.exists():
                continue
            text = skill_file.read_text()
            lines = text.split('\n')
            for i, line in enumerate(lines, 1):
                for pattern, desc in PAUSE_PATTERNS:
                    if pattern.search(line):
                        ctx = '\n'.join(lines[max(0, i - 4):min(len(lines), i + 2)])
                        if any(kw in ctx for kw in ALLOWED_CONTEXTS):
                            continue
                        violations.append(f"{skill_dir.name}/SKILL.md:{i} — {desc}: {line.strip()[:80]}")

    return violations


if __name__ == "__main__":
    import json, sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
