#!/usr/bin/env python3
"""Constraint: typst-slide-format — #callout[] + 3+ #pause on same slide = overflow risk."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-slide-format"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_typ_files(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(f for f in candidate.glob("*.typ") if "notes" not in f.stem)
    return files


def extract_slide_blocks(content: str) -> list[tuple[int, str]]:
    """Extract (start_line, slide_text) for each #slide[...] block."""
    slides = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        if "#slide[" in lines[i]:
            start = i
            depth = 0
            block_lines = []
            for j in range(i, len(lines)):
                line = lines[j]
                block_lines.append(line)
                depth += line.count("[") - line.count("]")
                if depth <= 0 and j > i:
                    break
            slides.append((start + 1, "\n".join(block_lines)))
            i = j + 1 if j > i else i + 1
        else:
            i += 1
    return slides


def check(context: dict) -> list[dict]:
    cwd = context.get("cwd", ".")
    violations = []

    for typ_file in find_typ_files(cwd):
        content = typ_file.read_text()
        for start_line, slide_text in extract_slide_blocks(content):
            pause_count = slide_text.count("#pause")
            has_callout = "#callout[" in slide_text
            if has_callout and pause_count >= 3:
                violations.append({
                    "file": str(typ_file),
                    "line": start_line,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"#callout[] + {pause_count} #pause on slide starting at L{start_line}",
                    "expected": "Split slide — #callout with 3+ #pause causes overflow risk",
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
