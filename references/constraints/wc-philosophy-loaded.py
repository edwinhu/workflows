#!/usr/bin/env python3
"""Constraint: wc-philosophy-loaded — STATE.md must show philosophy step completed before design artifacts."""

CONSTRAINT = "wc-philosophy-loaded"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "hard"

import sys
from pathlib import Path
import re


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    cwd = Path(context.get("cwd", "."))

    wc_dir = cwd / ".planning" / "wc"
    if not wc_dir.exists():
        return violations  # no workflow-creator state — not applicable

    for name_dir in wc_dir.iterdir():
        if not name_dir.is_dir():
            continue
        state = name_dir / "STATE.md"
        design = name_dir / "DESIGN.md"
        interview = name_dir / "INTERVIEW.md"

        if not state.exists():
            if design.exists() or interview.exists():
                violations.append(
                    f"{name_dir.name}: DESIGN.md or INTERVIEW.md exists but STATE.md is missing"
                )
            continue

        content = state.read_text()

        # Only check workflow-creator "create" mode state (not audit/improve)
        is_create_mode = bool(re.search(r"mode:\s*create", content))
        if not is_create_mode:
            continue

        has_philosophy = bool(re.search(r"step:\s*1-philosophy", content))
        has_completed = bool(re.search(r"status:\s*completed", content))

        if (design.exists() or interview.exists()) and not (has_philosophy and has_completed):
            violations.append(
                f"{name_dir.name}: design/interview artifacts exist but STATE.md does not show philosophy step completed"
            )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
