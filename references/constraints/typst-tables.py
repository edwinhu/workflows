#!/usr/bin/env python3
"""Constraint: typst-tables — Tables must have inset >= 10pt."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-tables"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_typ_files(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(candidate.glob("*.typ"))
    return files


def check(context: dict) -> list[dict]:
    cwd = context.get("cwd", ".")
    violations = []

    for typ_file in find_typ_files(cwd):
        lines = typ_file.read_text().splitlines()
        for i, line in enumerate(lines):
            match = re.search(r"inset:\s*(\d+)pt", line)
            if match and int(match.group(1)) < 10:
                violations.append({
                    "file": str(typ_file),
                    "line": i + 1,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"Table inset {match.group(1)}pt at L{i+1}",
                    "expected": "Table inset >= 10pt",
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
