#!/usr/bin/env python3
"""Constraint: typst-fletcher-diagrams — Fletcher diagram conventions (spacing, storytelling comment, no oversized spacing)."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-fletcher-diagrams"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_typ_files(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(f for f in candidate.glob("*.typ") if "notes" not in f.stem)
    return files


def check(context: dict) -> list[dict]:
    cwd = context.get("cwd", ".")
    violations = []

    for typ_file in find_typ_files(cwd):
        lines = typ_file.read_text().splitlines()

        for i, line in enumerate(lines):
            # Check 1: fletcher-diagram without Storytelling comment
            if "#fletcher-diagram(" in line:
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
                        "found": f"fletcher-diagram without // Storytelling: comment at L{i+1}",
                        "expected": "// Storytelling: comment within 3 lines before #fletcher-diagram(",
                    })

            # Check 2: Oversized spacing in fletcher diagrams
            spacing_match = re.search(r"spacing:\s*\((\d+)em,\s*(\d+)em\)", line)
            if spacing_match and "fletcher" in typ_file.read_text():
                h_space = int(spacing_match.group(1))
                v_space = int(spacing_match.group(2))
                if h_space >= 5 or v_space >= 3:
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"Oversized fletcher spacing ({h_space}em, {v_space}em) at L{i+1}",
                        "expected": "Max spacing: (4em, 2em). Start at (2em, 2em).",
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
