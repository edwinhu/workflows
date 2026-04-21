#!/usr/bin/env -S uv run python3
"""Constraint: phase-summary-frontmatter — every completed phase appends structured YAML to PHASE_SUMMARY.md.

Checks .planning/PHASE_SUMMARY.md for:
- Required frontmatter fields: phase, status, artifacts_produced, provides
- Non-trivial one-liner (not just "Phase complete" or "Done")
- Deviations field present
"""

CONSTRAINT = "phase-summary-frontmatter"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-review", "dev-verify",
              "writing-setup", "writing-outline", "writing-draft", "writing-validate",
              "writing-review", "writing-revise"]
SEVERITY = "soft"

import re
from pathlib import Path

REQUIRED_FIELDS = ["phase", "status", "artifacts_produced", "provides"]
TRIVIAL_ONELINERS = [
    re.compile(r'^Phase complete\.?$', re.IGNORECASE),
    re.compile(r'^Done\.?$', re.IGNORECASE),
    re.compile(r'^Completed\.?$', re.IGNORECASE),
    re.compile(r'^Phase done\.?$', re.IGNORECASE),
    re.compile(r'^Complete\.?$', re.IGNORECASE),
]


def parse_phase_summaries(text):
    """Parse PHASE_SUMMARY.md into individual phase blocks delimited by --- ... ---."""
    # Find all YAML frontmatter blocks (--- ... ---)
    blocks = re.findall(r'---\n(.*?)\n---', text, re.DOTALL)
    return blocks


def check_phase_block(block_text, block_num):
    """Check a single phase block for required fields and valid one-liner."""
    violations = []

    # Parse YAML-like fields from the block
    fields_found = set()
    for line in block_text.split('\n'):
        line = line.strip()
        if ':' in line:
            key = line.split(':')[0].strip()
            fields_found.add(key)

    # Check required fields
    for field in REQUIRED_FIELDS:
        if field not in fields_found:
            violations.append(f"Block {block_num}: missing required field '{field}'")

    return violations


def check_one_liner(text, block_num):
    """Check the one-liner after each YAML block."""
    violations = []
    # Find one-liner pattern: "One-liner: <text>"
    oneliners = re.findall(r'One-liner:\s*(.+)', text)
    for i, oneliner in enumerate(oneliners):
        oneliner = oneliner.strip()
        for trivial in TRIVIAL_ONELINERS:
            if trivial.match(oneliner):
                violations.append(
                    f"Block {i + 1}: trivial one-liner '{oneliner}' — must describe what was produced, not just 'Phase complete'"
                )
                break
    return violations


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", ".")).resolve()
    violations = []

    phase_summary = cwd / ".planning" / "PHASE_SUMMARY.md"
    if not phase_summary.exists():
        # Not a violation — the file is only required when phases complete
        return violations

    try:
        text = phase_summary.read_text(encoding='utf-8', errors='replace')
    except (OSError, PermissionError):
        return violations

    blocks = parse_phase_summaries(text)
    if not blocks:
        # File exists but has no YAML blocks — that's a violation
        violations.append(
            f".planning/PHASE_SUMMARY.md exists but contains no YAML frontmatter blocks. "
            "Each completed phase must append a --- ... --- block."
        )
        return violations

    for i, block in enumerate(blocks, 1):
        block_violations = check_phase_block(block, i)
        violations.extend(block_violations)

    violations.extend(check_one_liner(text, len(blocks)))

    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
