#!/usr/bin/env python3
"""Constraint: ds-standard-error-spec — match SE type to data structure."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-standard-error-spec"
APPLIES_TO = ["ds-delegate"]
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
                        f"{path.relative_to(cwd)}:{i}: OLS .fit() without cov_type — "
                        "default SEs assume i.i.d.; specify cov_type='HC3' or cluster"
                    )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
