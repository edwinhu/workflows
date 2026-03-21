#!/usr/bin/env python3
"""Constraint: ds-deviation-rules — every completed task in LEARNINGS.md must have deviation summary."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-deviation-rules"
APPLIES_TO = ["ds", "ds-fix", "ds-implement", "ds-delegate"]
SEVERITY = "hard"

# Matches task completion headers like "## Task 3: ... - COMPLETE"
TASK_COMPLETE_PATTERN = re.compile(
    r'^##\s+Task\s+\d+[^-\n]*-\s*COMPLETE',
    re.IGNORECASE,
)

DEVIATION_PATTERN = re.compile(
    r'\*\*Deviations?\*\*|Deviations?:',
    re.IGNORECASE,
)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    learnings_path = cwd / ".planning" / "LEARNINGS.md"
    if not learnings_path.exists():
        # No LEARNINGS.md — nothing to check
        return violations

    try:
        content = learnings_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return violations

    lines = content.splitlines()
    i = 0
    while i < len(lines):
        if TASK_COMPLETE_PATTERN.match(lines[i]):
            task_header_line = i + 1  # 1-indexed
            # Scan the next 15 lines for a Deviations: entry
            end = min(len(lines), i + 15)
            task_block = "\n".join(lines[i:end])
            if not DEVIATION_PATTERN.search(task_block):
                violations.append(
                    f".planning/LEARNINGS.md:{task_header_line}: completed task entry missing "
                    "'Deviations:' summary — R1-R4 counts required"
                )
        i += 1

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
