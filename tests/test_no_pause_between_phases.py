#!/usr/bin/env -S uv run python3
"""No Pause Between Tasks, as a gated lint over this repo's writing skills.

Scans skills/writing*/SKILL.md for phrasing that tells the model to stop between tasks
("should I continue?", "wait for confirmation"), excluding the contexts where such
phrasing is the subject rather than the instruction (decision checkpoints, Red Flag rows,
explicit negations).

Was scripts/checks/check-no-pause-between-phases.py, which nothing ran and which exited 0
when it found no skills directory. Collected here by pytest tests/ (plugin-audit's python
leg); as a CLI it exits 2 for could-not-run, 1 for violations, 0 for clean.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"

PAUSE_PATTERNS = [
    (re.compile(r"should I continue\??", re.IGNORECASE), "asks permission to continue"),
    (re.compile(r"wait for (user |human )?confirmation", re.IGNORECASE), "waits for confirmation"),
    (re.compile(r"pause (for|and) (ask|wait|get)", re.IGNORECASE), "pauses for input"),
    (re.compile(r"ask.*before proceeding", re.IGNORECASE), "asks before proceeding"),
]

# Contexts where the phrasing is quoted as the anti-pattern, or names a real decision gate.
ALLOWED_CONTEXTS = [
    "decision",
    "human-action",
    "checkpoint_type",
    "AskUserQuestion",
    "Do NOT",
    "Do not",
    "NOT:",
    "NO ",
    'NO"',
    "NO '",
    "Do NOT:",
    "NEVER",
    "feedback",
    "Red Flag",
    "Rationalization",
    "IMMEDIATELY proceed",
    "IMMEDIATELY start",
]


def writing_skill_files() -> list[Path]:
    if not SKILLS_DIR.is_dir():
        return []
    return sorted(
        d / "SKILL.md"
        for d in SKILLS_DIR.iterdir()
        if d.is_dir() and d.name.startswith("writing") and (d / "SKILL.md").is_file()
    )


def violations_in(path: Path) -> list[str]:
    found: list[str] = []
    lines = path.read_text(encoding="utf-8").split("\n")
    for i, line in enumerate(lines, 1):
        for pattern, desc in PAUSE_PATTERNS:
            if not pattern.search(line):
                continue
            context = "\n".join(lines[max(0, i - 4) : min(len(lines), i + 2)])
            if any(kw in context for kw in ALLOWED_CONTEXTS):
                continue
            found.append(f"{path.relative_to(ROOT)}:{i} — {desc}: {line.strip()[:80]}")
    return found


def test_writing_skills_are_present() -> None:
    """Scanning nothing is could-not-run, never a pass."""
    files = writing_skill_files()
    assert SKILLS_DIR.is_dir(), f"no skills directory at {SKILLS_DIR} — the lint could not run"
    assert files, f"no skills/writing*/SKILL.md under {SKILLS_DIR} — the lint could not run"


def test_no_pause_patterns_in_writing_skills() -> None:
    files = writing_skill_files()
    assert files, f"no skills/writing*/SKILL.md under {SKILLS_DIR} — the lint could not run"
    found = [v for f in files for v in violations_in(f)]
    assert not found, "pause-between-tasks phrasing:\n" + "\n".join(found)


def main() -> int:
    files = writing_skill_files()
    if not files:
        missing = SKILLS_DIR if not SKILLS_DIR.is_dir() else f"{SKILLS_DIR}/writing*/SKILL.md"
        print(f"COULD NOT RUN: no-pause-between-phases — nothing to scan: {missing}")
        return 2
    found = [v for f in files for v in violations_in(f)]
    if found:
        for v in found:
            print(f"FAIL: {v}")
        return 1
    print(f"PASS: no-pause-between-phases — {len(files)} writing SKILL.md scanned, no pause phrasing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
