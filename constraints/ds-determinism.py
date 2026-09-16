#!/usr/bin/env -S uv run python3
"""Constraint: ds-determinism — every pipeline step must be deterministic."""
import re
import os
import sys
from pathlib import Path

CONSTRAINT = "ds-determinism"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    # Find all Python files (skip .planning/, scratch/, tests/)
    py_files = [
        p for p in cwd.rglob("*.py")
        if not any(part in p.parts for part in [".planning", "scratch", "__pycache__", ".pixi", "worktrees", "node_modules"])
        and p.name != "run-constraints.py"
        and "constraints" not in str(p)
    ]

    for path in py_files:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        lines = source.splitlines()
        for i, line in enumerate(lines, start=1):
            # df.sample() or .sample( without random_state — look in next 3 lines too
            if re.search(r'\.sample\s*\(', line):
                # Check if random_state appears in same call (could span multiple lines)
                context_lines = "\n".join(lines[max(0, i-1):min(len(lines), i+3)])
                if "random_state" not in context_lines:
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: .sample() without random_state — non-deterministic"
                    )

    return violations


if __name__ == "__main__":
    _cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    violations = check({"cwd": _cwd})
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _ds_waivers import partition  # noqa: E402
    violations, _waived = partition(violations, _cwd, CONSTRAINT)
    if _waived:
        print(f"WAIVED: {len(_waived)} finding(s) with a stated reason")
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
