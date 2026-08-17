#!/usr/bin/env -S uv run python3
"""Constraint: typst-formatting — escaped dollar signs, smart apostrophes after ) or ]."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-formatting"
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
            # Skip comment lines
            stripped = line.strip()
            if stripped.startswith("//"):
                continue

            # Check: unescaped dollar sign before digits
            if re.search(r"[^\\]\$\d", line):
                violations.append({
                    "file": str(typ_file),
                    "line": i + 1,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"Unescaped dollar sign at L{i+1}",
                    "expected": "Use \\$ instead of $ before numbers",
                })

            # Check: smart apostrophe issue — )'s or ]'s
            if re.search(r"[)\]]'s", line):
                violations.append({
                    "file": str(typ_file),
                    "line": i + 1,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"Smart apostrophe issue at L{i+1}",
                    "expected": "Use \\u{2019}s after ) or ]",
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
