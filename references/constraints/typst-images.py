#!/usr/bin/env python3
"""Constraint: typst-images — All #image() calls must be wrapped in #align(center)."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-images"
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
            if "#image(" in line and "align(center)" not in line:
                # Check previous line for align(center)
                if i == 0 or "align(center)" not in lines[i - 1]:
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"Uncentered image at L{i+1}",
                        "expected": "#image() wrapped in #align(center)[...]",
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
