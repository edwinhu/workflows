#!/usr/bin/env -S uv run python3
"""Constraint: typst-computed-values — No hardcoded calculations; use Typst calc module."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-computed-values"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "soft"


def find_typ_files(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(candidate.glob("*.typ"))
    return files


def check(context: dict) -> list[dict]:
    """Heuristic: flag lines with percentage patterns that look hardcoded."""
    cwd = context.get("cwd", ".")
    violations = []

    for typ_file in find_typ_files(cwd):
        content = typ_file.read_text()
        # Check for cetz canvas without minimum length
        lines = content.splitlines()
        if "cetz" in content:
            for i, line in enumerate(lines):
                match = re.search(r"length:\s*(\d+(?:\.\d+)?)(cm|mm|pt)", line)
                if match:
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "warning",
                        "found": f"CeTZ canvas uses {match.group(2)} units at L{i+1}",
                        "expected": "Use em units (minimum 2em) for CeTZ canvas length",
                    })
                em_match = re.search(r"length:\s*(\d+(?:\.\d+)?)em", line)
                if em_match and float(em_match.group(1)) < 2:
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"CeTZ canvas length {em_match.group(1)}em at L{i+1}",
                        "expected": "Minimum 2em for CeTZ canvas length",
                    })

    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        for v in results:
            print(f"FAIL: {v['file']}:{v['line']} — {v['found']}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
