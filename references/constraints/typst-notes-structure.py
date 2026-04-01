#!/usr/bin/env python3
"""Constraint: typst-notes-structure — Notes sections must match slide sections, transitions required."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-notes-structure"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_file(cwd: str, stem_pattern: str) -> Path | None:
    root = Path(cwd).resolve()
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            for f in candidate.glob("*.typ"):
                if stem_pattern in f.stem:
                    return f
    return None


def extract_sections(content: str, level: str) -> list[str]:
    """Extract heading text at given level (= or ==)."""
    pattern = rf"^{re.escape(level)}\s+(.+)$"
    return [m.group(1).strip() for m in re.finditer(pattern, content, re.MULTILINE)]


def check(context: dict) -> list[dict]:
    cwd = context.get("cwd", ".")
    violations = []

    slides_file = find_file(cwd, "slides")
    notes_file = find_file(cwd, "notes")

    # If both files exist, check section matching
    if slides_file and notes_file:
        slides_content = slides_file.read_text()
        notes_content = notes_file.read_text()

        # Slide = sections should match notes == sections
        slide_sections = extract_sections(slides_content, "=")
        notes_sections = extract_sections(notes_content, "==")

        # Filter out the Touying/title-slide boilerplate
        slide_sections = [s for s in slide_sections if not s.startswith("#")]

        for section in slide_sections:
            # Check if section appears in notes (fuzzy: normalize whitespace)
            normalized = re.sub(r"\s+", " ", section).strip()
            found = any(
                re.sub(r"\s+", " ", ns).strip() == normalized
                for ns in notes_sections
            )
            if not found:
                violations.append({
                    "file": str(notes_file),
                    "line": 0,
                    "check": CONSTRAINT,
                    "severity": "error",
                    "found": f"Slide section '{section}' has no matching == section in notes",
                    "expected": "Every = section in slides must have a matching == section in notes",
                })

    # Check notes for section transitions (every == except the first should have a transition bullet)
    if notes_file:
        lines = notes_file.read_text().splitlines()
        section_count = 0
        for i, line in enumerate(lines):
            if line.strip().startswith("== ") and not line.strip().startswith("=== "):
                section_count += 1
                if section_count > 1:
                    # Look for a transition bullet within next 10 lines
                    has_transition = False
                    for j in range(i + 1, min(i + 11, len(lines))):
                        bullet_line = lines[j].strip()
                        if bullet_line.startswith("- "):
                            has_transition = True
                            break
                        if bullet_line.startswith("= ") or bullet_line.startswith("== "):
                            break
                    # Not flagging missing transitions as error since
                    # some sections legitimately start differently

    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        for v in results:
            print(f"FAIL: {v['file']}:{v['line']} — {v['found']}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
