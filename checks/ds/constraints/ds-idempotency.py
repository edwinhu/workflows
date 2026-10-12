#!/usr/bin/env -S uv run python3
"""Constraint: ds-idempotency — running pipeline N times must equal running it once."""
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main, rel

CONSTRAINT = "ds-idempotency"
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    py_files = context["files"]  # the runner hands the files; none is pruned here

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
                    f"{rel(path, cwd)}:{i}: if_exists='append' — non-idempotent; "
                    "use 'replace' or deduplicate"
                )

            # File opened in append mode: open(..., 'a') or open(..., "a")
            # Match open( with 'a' or "a" as mode (2nd positional or mode= kwarg)
            if re.search(r'\bopen\s*\([^)]*,\s*["\']a["\']', line):
                violations.append(
                    f"{rel(path, cwd)}:{i}: open() in append mode — "
                    "non-idempotent; use write mode 'w'"
                )

    return violations


if __name__ == "__main__":
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".py"))
