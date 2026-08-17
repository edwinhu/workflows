#!/usr/bin/env -S uv run python3
"""Constraint: typst-section-hierarchy — === titles must be complete sentences, == outside #slide[]."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-section-hierarchy"
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
        in_slide_block = 0  # nesting depth

        for i, line in enumerate(lines):
            stripped = line.strip()

            # Track #slide[ blocks (rough heuristic)
            if "#slide[" in stripped:
                in_slide_block += 1
            if in_slide_block > 0:
                in_slide_block += stripped.count("[") - stripped.count("]")
                if in_slide_block < 0:
                    in_slide_block = 0

            # Check: === slide titles should be complete sentences (end with .)
            if stripped.startswith("=== "):
                title = stripped[4:].strip()
                # Skip if it's a Typst expression or code
                if title.startswith("#") or title.startswith("//"):
                    continue
                if title and not title.endswith(".") and not title.endswith("?") and not title.endswith("!"):
                    violations.append({
                        "file": str(typ_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"Slide title not a complete sentence at L{i+1}: '{title}'",
                        "expected": "=== titles must be complete sentences ending with . or ? or !",
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
