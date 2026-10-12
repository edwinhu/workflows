#!/usr/bin/env -S uv run python3
"""Constraint: ds-schema-contracts — every transformation has input/output schema contracts."""
import re
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _contract import files_main, rel
from _ds_logging import declared_helpers, helper_reports  # noqa: E402

CONSTRAINT = "ds-schema-contracts"
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


# `read_parquet(columns=["a", "b"])` IS the contract, enforced by the reader itself: a named
# column that is absent raises ColumnNotFoundError (polars) / ArrowInvalid (pandas, pyarrow),
# verified 2026-09-16. A variable (`columns=columns`) or an empty list asserts nothing.
LITERAL_COLUMNS = re.compile(r"""columns\s*=\s*\[\s*["']""")


def statement(lines, i):
    """The full source of the statement starting at 0-based line `i`, by bracket balance."""
    depth = 0
    for k in range(i, min(i + 40, len(lines))):
        for ch in lines[k]:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
        if depth <= 0:
            return "\n".join(lines[i:k + 1])
    return lines[i]


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    helpers = declared_helpers(cwd)

    py_files = context["files"]  # the runner hands the files; none is pruned here

    for path in py_files:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        lines = source.splitlines()
        for i, line in enumerate(lines, start=1):
            if any(re.search(pat, line) for pat in DATA_LOAD_PATTERNS):
                # Check 10 lines after load for schema validation
                if LITERAL_COLUMNS.search(statement(lines, i - 1)):
                    continue
                end = min(len(lines), i + 10)
                post_load = "\n".join(lines[i:end])
                if helper_reports(post_load, statement(lines, i - 1), helpers):
                    continue
                if not any(re.search(pat, post_load) for pat in SCHEMA_CHECK_PATTERNS):
                    violations.append(
                        f"{rel(path, cwd)}:{i}: data load without schema contract — "
                        "assert expected columns after read"
                    )

    return violations


if __name__ == "__main__":
    # A finding the rule does not fit is closed by a REASON on the line, never by weakening the
    # rule. Waived findings are counted here so they stay visible: _ds_waivers.py says why.
    raise SystemExit(files_main(CONSTRAINT, check, lambda p: p.suffix == ".py"))
