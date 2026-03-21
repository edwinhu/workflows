#!/usr/bin/env python3
"""Constraint: ds-idempotency — running pipeline N times must equal running it once."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-idempotency"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    py_files = [
        p for p in cwd.rglob("*.py")
        if not any(part in p.parts for part in [".planning", "scratch", "__pycache__", ".pixi"])
        and p.name != "check-all.py"
        and "references/constraints" not in str(p)
    ]

    for path in py_files:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        lines = source.splitlines()
        for i, line in enumerate(lines, start=1):
            # to_sql with if_exists='append'
            if re.search(r'if_exists\s*=\s*["\']append["\']', line):
                violations.append(
                    f"{path.relative_to(cwd)}:{i}: if_exists='append' — non-idempotent; "
                    "use 'replace' or deduplicate"
                )

            # File opened in append mode: open(..., 'a') or open(..., "a")
            # Match open( with 'a' or "a" as mode (2nd positional or mode= kwarg)
            if re.search(r'\bopen\s*\([^)]*,\s*["\']a["\']', line):
                violations.append(
                    f"{path.relative_to(cwd)}:{i}: open() in append mode — "
                    "non-idempotent; use write mode 'w'"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
