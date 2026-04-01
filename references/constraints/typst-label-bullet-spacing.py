#!/usr/bin/env python3
"""Constraint: typst-label-bullet-spacing — Blank line required between *Label:* and following bullet list."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-label-bullet-spacing"
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
        for i in range(len(lines) - 1):
            curr = lines[i].strip()
            nxt = lines[i + 1].strip()
            # Bold label pattern: *Something:* followed immediately by a bullet
            if re.match(r"^\*[^*]+:\*\s*$", curr) and re.match(r"^-\s", nxt):
                violations.append({
                    "file": str(typ_file),
                    "line": i + 1,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"Bold label at L{i+1} immediately followed by bullet at L{i+2}",
                    "expected": "Blank line between *Label:* and following bullet list",
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
