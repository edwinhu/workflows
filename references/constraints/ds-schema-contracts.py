#!/usr/bin/env -S uv run python3
"""Constraint: ds-schema-contracts — every transformation has input/output schema contracts."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-schema-contracts"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"


# Patterns that load data without schema validation
DATA_LOAD_PATTERNS = [
    r'\bpd\.read_csv\s*\(',
    r'\bpd\.read_parquet\s*\(',
    r'\bpd\.read_sql\s*\(',
    r'\bpd\.read_excel\s*\(',
    r'\bpd\.read_json\s*\(',
    r'\bpl\.read_csv\s*\(',     # polars
    r'\bpl\.read_parquet\s*\(',
]

SCHEMA_CHECK_PATTERNS = [
    r'\bassert\b',
    r'\.columns\b',
    r'EXPECTED_COL',
    r'required_col',
    r'schema\b',
    r'validate\b',
    r'pandera\b',
    r'Schema\(',
]


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
            if any(re.search(pat, line) for pat in DATA_LOAD_PATTERNS):
                # Check 10 lines after load for schema validation
                end = min(len(lines), i + 10)
                post_load = "\n".join(lines[i:end])
                if not any(re.search(pat, post_load) for pat in SCHEMA_CHECK_PATTERNS):
                    violations.append(
                        f"{path.relative_to(cwd)}:{i}: data load without schema contract — "
                        "assert expected columns after read"
                    )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
