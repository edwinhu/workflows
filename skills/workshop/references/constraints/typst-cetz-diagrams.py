#!/usr/bin/env -S uv run python3
"""Constraint: typst-cetz-diagrams — CeTZ canvas minimum length 2em, no cetz-plot, storytelling comment required."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-cetz-diagrams"
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
            # Check 1: cetz-plot import (banned)
            if "cetz-plot" in line:
                violations.append({
                    "file": str(typ_file),
                    "line": i + 1,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"cetz-plot import at L{i+1}",
                    "expected": "cetz-plot is FORBIDDEN (version conflict). Use #table() instead.",
                })

            # Check 2: cetz.canvas with small length
            length_match = re.search(r"length:\s*(\d+(?:\.\d+)?)(cm|mm|pt|em)", line)
            if length_match and "cetz" in typ_file.read_text():
                val = float(length_match.group(1))
                unit = length_match.group(2)
                if unit == "em" and val < 2:
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"CeTZ canvas length {val}{unit} at L{i+1}",
                        "expected": "Minimum length: 2em",
                    })
                elif unit in ("cm", "mm", "pt"):
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"CeTZ canvas uses {unit} units at L{i+1}",
                        "expected": "Use em units (minimum 2em)",
                    })

            # Check 3: cetz.canvas without // Storytelling: comment
            if "cetz.canvas(" in line:
                has_storytelling = False
                for j in range(max(0, i - 3), i):
                    if "// Storytelling:" in lines[j]:
                        has_storytelling = True
                        break
                if not has_storytelling:
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"cetz.canvas without // Storytelling: comment at L{i+1}",
                        "expected": "// Storytelling: comment within 3 lines before cetz.canvas(",
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
