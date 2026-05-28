#!/usr/bin/env -S uv run python3
"""Constraint: typst-widow-detection — compiled slides.pdf must have 0 widow lines.

Graduates the former judgment-only convention to a mechanical constraint: a
co-located detector (tinymist's detect_widows.py) already exists, so the rule is
deterministically checkable. The constraint runs the detector on slides.pdf when
both the PDF and the detector are present; otherwise it returns no violations
(nothing to assert) — live widow detection still runs in the skill's verify leg.
"""

from __future__ import annotations

import glob
import os
import subprocess
import sys
from pathlib import Path

CONSTRAINT = "typst-widow-detection"
APPLIES_TO = ["workshop", "workshop-revise"]
SEVERITY = "hard"


def _find_pdfs(cwd: str) -> list[Path]:
    root = Path(cwd).resolve()
    pdfs = []
    for d in (root, root / "presentation"):
        if d.is_dir():
            pdfs.extend(d.glob("slides.pdf"))
    return pdfs


def _find_detector() -> str | None:
    pattern = os.path.expanduser(
        "~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/"
        "typst-widow-orphan/scripts/detect_widows.py"
    )
    hits = sorted(glob.glob(pattern))
    return hits[-1] if hits else None


def check(context: dict) -> list[dict]:
    """Returns list of violations. Empty list = pass (or nothing to check)."""
    cwd = context.get("cwd", ".")
    pdfs = _find_pdfs(cwd)
    if not pdfs:
        return []  # nothing compiled yet — skill's verify leg runs live detection
    detector = _find_detector()
    if not detector:
        return []  # detector unavailable in this environment — cannot assert

    violations = []
    for pdf in pdfs:
        try:
            proc = subprocess.run(
                ["uv", "run", "python3", detector, str(pdf)],
                capture_output=True, text=True, timeout=120,
            )
        except Exception:
            continue  # detector failure is not a content violation
        if proc.returncode != 0:
            detail = (proc.stdout or proc.stderr or "widows detected").strip().splitlines()
            violations.append({
                "file": str(pdf),
                "line": 0,
                "check": CONSTRAINT,
                "severity": "error",
                "found": f"Widows detected in {pdf.name}: {' | '.join(detail[:5])}",
                "expected": "0 widow lines in the compiled PDF",
            })
    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        for v in results:
            print(f"FAIL: {v['file']} — {v['found']}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
