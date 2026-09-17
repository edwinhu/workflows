#!/usr/bin/env -S uv run python3
"""Constraint: ds-join-audits — every merge/join must produce diagnostic log."""
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _ds_logging import reports_operation, statement_text  # noqa: E402

CONSTRAINT = "ds-join-audits"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    py_files = [
        p for p in cwd.rglob("*.py")
        if not any(part in p.parts for part in [".planning", "scratch", "__pycache__", ".pixi", "worktrees", "node_modules", "external", "vendor"])
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
            # Detect .merge( calls (DataFrame merge)
            if re.search(r'\.merge\s*\(', line) or re.search(r'\bpd\.merge\s*\(', line):
                # Surrounding 5 lines before and after. The log must REPORT THIS MERGE:
                # a quantity (len()/.shape/row/match words) linked by a name from the
                # merge's own line. Any-print-nearby was proximity, not a diagnostic.
                start = max(0, i - 6)
                end = min(len(lines), i + 5)
                context_block = "\n".join(lines[start:end])
                if not reports_operation(context_block, statement_text(lines, i - 1)):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: .merge() without diagnostic print — "
                        "log row counts, match rates, key uniqueness"
                    )

    return violations


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"COULD-NOT-RUN: {CONSTRAINT} was given no project directory — nothing was checked", file=sys.stderr)
        print(f"Usage: python3 {sys.argv[0]} <project-dir>", file=sys.stderr)
        sys.exit(2)
    _cwd = sys.argv[1]
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
