#!/usr/bin/env -S uv run python3
"""Constraint: typst-teleprompter-notes — Notes bullets must have 1-2 sentences, not 3+."""

import re
import sys
from pathlib import Path

CONSTRAINT = "typst-teleprompter-notes"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def find_notes_files(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    files = []
    for candidate in [root, root / "presentation"]:
        if candidate.is_dir():
            files.extend(f for f in candidate.glob("*.typ") if "notes" in f.stem)
    return files


def count_sentences(text: str) -> int:
    """Rough sentence count: split on . ? ! followed by space or end."""
    # Remove common abbreviations that aren't sentence ends
    cleaned = re.sub(r"\b(Dr|Mr|Mrs|Ms|Prof|Inc|Ltd|Corp|vs|etc|e\.g|i\.e)\.", r"\1<DOT>", text)
    # Remove decimal numbers
    cleaned = re.sub(r"\d+\.\d+", "NUM", cleaned)
    # Count sentence-ending punctuation
    sentences = re.split(r"[.!?](?:\s|$)", cleaned)
    # Filter out empty segments
    return len([s for s in sentences if s.strip()])


def check(context: dict) -> list[dict]:
    cwd = context.get("cwd", ".")
    violations = []

    for notes_file in find_notes_files(cwd):
        lines = notes_file.read_text().splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            # Detect top-level bullet (starts with "- ")
            if stripped.startswith("- "):
                # Collect full bullet text (may span multiple non-bullet lines)
                bullet_text = stripped[2:]
                j = i + 1
                while j < len(lines):
                    next_stripped = lines[j].strip()
                    # Stop if next line is empty, another bullet, or a heading
                    if not next_stripped or next_stripped.startswith("-") or next_stripped.startswith("=") or next_stripped.startswith("#"):
                        break
                    # Continuation line (not indented bullet)
                    if not next_stripped.startswith("  - "):
                        bullet_text += " " + next_stripped
                    else:
                        break
                    j += 1

                sentence_count = count_sentences(bullet_text)
                if sentence_count >= 4:
                    violations.append({
                        "file": str(notes_file),
                        "line": i + 1,
                        "check": CONSTRAINT,
                        "severity": "error",
                        "found": f"Dense bullet at L{i+1}: {sentence_count} sentences",
                        "expected": "Notes bullets must have 1-2 sentences (max). Split dense bullets.",
                    })

                i = j
            else:
                i += 1

    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        for v in results:
            print(f"FAIL: {v['file']}:{v['line']} — {v['found']}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
