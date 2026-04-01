#!/usr/bin/env python3
"""Constraint: typst-no-subtitle-echo — === title must not repeat as first body line."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-no-subtitle-echo"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_typ_files(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(candidate.glob("*.typ"))
    return files


def normalize(text: str) -> str:
    """Strip formatting markers for comparison."""
    text = re.sub(r"[*_#\[\]]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().rstrip(".")


def check(context: dict) -> list[dict]:
    cwd = context.get("cwd", ".")
    violations = []

    for typ_file in find_typ_files(cwd):
        lines = typ_file.read_text().splitlines()
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith("=== "):
                title = stripped[4:].strip()
                # Look for first non-empty, non-whitespace body line within next 5 lines
                for j in range(i + 1, min(i + 6, len(lines))):
                    body_line = lines[j].strip()
                    if not body_line:
                        continue
                    if body_line.startswith("=") or body_line.startswith("#"):
                        break
                    # Compare normalized versions
                    if normalize(title) and normalize(body_line):
                        if normalize(title).lower() == normalize(body_line).lower():
                            violations.append({
                                "file": str(typ_file),
                                "line": i + 1,
                                "check": CONSTRAINT,
                                "severity": "error",
                                "found": f"Subtitle-body echo at L{i+1}: title repeated as body text",
                                "expected": "Body content should add information, not repeat the slide title",
                            })
                    break  # Only check first body line

    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        for v in results:
            print(f"FAIL: {v['file']}:{v['line']} — {v['found']}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
