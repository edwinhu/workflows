#!/usr/bin/env python3
"""Check: no-pause-between-phases — verify writing skill files don't contain pause patterns.

Scans writing-* SKILL.md files for patterns that encourage pausing between tasks:
- "Should I continue?"
- "Wait for confirmation"
- "Pause for user input" (at non-decision checkpoints)
"""
import re
import sys
from pathlib import Path

PAUSE_PATTERNS = [
    (re.compile(r'should I continue\??', re.IGNORECASE), "asks permission to continue"),
    (re.compile(r'wait for (user |human )?confirmation', re.IGNORECASE), "waits for confirmation"),
    (re.compile(r'pause (for|and) (ask|wait|get)', re.IGNORECASE), "pauses for input"),
    (re.compile(r'ask.*before proceeding', re.IGNORECASE), "asks before proceeding"),
]

# These are OK — they're negations, decision checkpoints, or examples of what NOT to do
ALLOWED_CONTEXTS = [
    'decision',
    'human-action',
    'checkpoint_type',
    'AskUserQuestion',
    'Do NOT',
    'Do not',
    'NOT:',
    'NO ',
    'NO"',
    "NO '",
    'Do NOT:',
    'NEVER',
    'feedback',   # brainstorm feedback checkpoint is a decision gate
    'Red Flag',
    'Rationalization',
    'IMMEDIATELY proceed',
    'IMMEDIATELY start',
]

violations = []


def check_file(filepath: Path):
    text = filepath.read_text()
    lines = text.split('\n')
    for i, line in enumerate(lines, 1):
        for pattern, desc in PAUSE_PATTERNS:
            if pattern.search(line):
                # Check if this is in an allowed context (decision checkpoint discussion)
                context = '\n'.join(lines[max(0, i - 4):min(len(lines), i + 2)])
                if any(kw in context for kw in ALLOWED_CONTEXTS):
                    continue
                violations.append(f"FAIL: {filepath}:{i} — {desc}: {line.strip()[:80]}")


def main():
    # Find the plugin skills directory
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        print("PASS: no-pause-between-phases — skills directory not found (not in plugin context)")
        sys.exit(0)

    for skill_dir in sorted(skills_dir.iterdir()):
        if skill_dir.name.startswith('writing') and skill_dir.is_dir():
            skill_file = skill_dir / 'SKILL.md'
            if skill_file.exists():
                check_file(skill_file)

    if violations:
        for v in violations:
            print(v)
        sys.exit(1)

    print("PASS: no-pause-between-phases — no inappropriate pause patterns found in writing skills")
    sys.exit(0)


if __name__ == '__main__':
    main()
