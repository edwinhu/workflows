#!/usr/bin/env -S uv run python3
"""Constraint: ds-standard-error-spec — match SE type to data structure."""
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main, rel

CONSTRAINT = "ds-standard-error-spec"
SEVERITY = "hard"


# Patterns for OLS estimation without robust/clustered SEs
OLS_FIT_PATTERN = re.compile(
    r'\.fit\s*\(\s*\)',  # bare .fit() with no arguments
)

OLS_CALL_PATTERNS = [
    re.compile(r'\bsm\.OLS\s*\('),
    re.compile(r'\bsmf\.ols\s*\('),
    re.compile(r'\bOLS\s*\('),
]

ROBUST_SE_PATTERN = re.compile(
    r'cov_type\s*=|HC[0-4]|robust|cluster|HAC|newey.?west',
    re.IGNORECASE,
)


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
            # Detect bare .fit() on a line that follows an OLS call
            if OLS_FIT_PATTERN.search(line):
                # Check surrounding context for robust SE specification
                start = max(0, i - 5)
                end = min(len(lines), i + 2)
                context_block = "\n".join(lines[start:end])

                is_ols = any(pat.search(context_block) for pat in OLS_CALL_PATTERNS)
                has_robust = ROBUST_SE_PATTERN.search(context_block)

                if is_ols and not has_robust:
                    violations.append(
                        f"{rel(path, cwd)}:{i}: OLS .fit() without cov_type — "  # scan: allow (message text, not a focused test)
                        "default SEs assume i.i.d.; specify cov_type='HC3' or cluster"
                    )

    return violations


if __name__ == "__main__":
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".py"))
