#!/usr/bin/env -S uv run python3
"""Constraint: typst-bullet-spacing — Blank lines between ALL top-level bullet items."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-bullet-spacing"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_typ_files(cwd: str) -> list[Path]:
    """Find .typ files in cwd and presentation/ subdirectory."""
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(candidate.glob("*.typ"))
    return files


def check(context: dict) -> list[dict]:
    """Returns list of violations. Empty list = pass."""
    cwd = context.get("cwd", ".")
    violations = []

    for typ_file in find_typ_files(cwd):
        lines = typ_file.read_text().splitlines()
        for i in range(len(lines) - 1):
            curr = lines[i].rstrip()
            nxt = lines[i + 1].rstrip()
            # Two consecutive lines both starting with top-level bullet (0-1 leading spaces + "- ")
            if re.match(r"^\s{0,1}-\s", curr) and re.match(r"^\s{0,1}-\s", nxt):
                violations.append({
                    "file": str(typ_file),
                    "line": i + 1,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"Consecutive bullets without blank line: L{i+1}-L{i+2}",
                    "expected": "Blank line between every top-level bullet item",
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
