#!/usr/bin/env -S uv run python3
"""Constraint: dev-deviation-rules — every task summary must include deviation tracking."""
import re
import sys
from pathlib import Path

CONSTRAINT = "dev-deviation-rules"
APPLIES_TO = ["dev-implement", "dev-delegate", "dev-tdd"]
SEVERITY = "hard"

_DEVIATION_PATTERN = re.compile(
    r"(deviations?|R[1-4]|Rule [1-4]|auto-fixed)", re.IGNORECASE
)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    planning = cwd / ".planning"
    if not planning.is_dir():
        return violations

    # Check LEARNINGS.md for task summaries with deviation tracking
    learnings_path = planning / "LEARNINGS.md"
    if learnings_path.exists():
        content = learnings_path.read_text(encoding="utf-8", errors="ignore")

        # Find task summary sections (## Task N or ### Task N)
        task_sections = re.split(r"(?=^##+ .*[Tt]ask\b)", content, flags=re.MULTILINE)

        for section in task_sections[1:]:  # skip preamble before first task
            lines = section.strip().splitlines()
            if not lines:
                continue
            header = lines[0].strip()
            section_text = "\n".join(lines)

            # Check if this task section has deviation tracking
            if not _DEVIATION_PATTERN.search(section_text):
                violations.append(
                    f".planning/LEARNINGS.md: task section '{header}' "
                    "has no deviation tracking — every task summary MUST include: "
                    "'Total deviations: N auto-fixed (R1: X, R2: Y, R3: Z). Impact: [assessment]'"
                )

    # Check STATE.md for completed tasks without deviation tracking
    state_path = planning / "STATE.md"
    if state_path.exists():
        state_content = state_path.read_text(encoding="utf-8", errors="ignore")
        # Look for completed task entries
        completed_tasks = re.findall(
            r"(?:completed|done|finished).*?task", state_content, re.IGNORECASE
        )
        # This is informational — the primary check is LEARNINGS.md

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
