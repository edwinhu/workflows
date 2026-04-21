#!/usr/bin/env -S uv run python3
"""Constraint check: detect slide overflow in workshop presentations.

Runs the overflow detection pipeline:
1. Creates a temporary validation wrapper around slides.typ
2. Compiles in handout mode (each slide = 1 page)
3. Queries Typst metadata for heading positions and page counts
4. Detects slides that spill beyond 1 page

Requires: typst CLI, slides.typ in cwd or provided path.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


def check(context: dict) -> list[dict]:
    """Run overflow detection. Returns list of violations."""
    cwd = Path(context.get("cwd", ".")).resolve()

    # Find slides.typ — check cwd and presentation/ subdirectory
    slides_path = None
    for candidate in [cwd / "slides.typ", cwd / "presentation" / "slides.typ"]:
        if candidate.exists():
            slides_path = candidate
            break

    if not slides_path:
        return []  # No slides to check

    # Find the check script
    script_dir = Path(__file__).resolve().parent.parent.parent / "scripts" / "checks"
    check_script = script_dir / "check-overflow.sh"

    if not check_script.exists():
        return [{
            "file": str(slides_path),
            "check": "TYPST-OVERFLOW",
            "severity": "error",
            "found": "check-overflow.sh not found",
            "expected": f"Script at {check_script}",
            "context": "Cannot run overflow detection without the check script",
        }]

    try:
        result = subprocess.run(
            ["bash", str(check_script), str(slides_path)],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(slides_path.parent),
        )
    except subprocess.TimeoutExpired:
        return [{
            "file": str(slides_path),
            "check": "TYPST-OVERFLOW",
            "severity": "warning",
            "found": "Overflow check timed out (60s)",
            "expected": "Check completes within timeout",
            "context": "Try running manually: bash check-overflow.sh slides.typ",
        }]
    except FileNotFoundError:
        return []  # typst not installed

    if result.returncode == 1:
        # Parse output for overflow details
        violations = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if line.startswith("Page ") and ":" in line:
                violations.append({
                    "file": str(slides_path),
                    "check": "TYPST-OVERFLOW",
                    "severity": "error",
                    "found": line,
                    "expected": "Each slide fits on 1 page",
                    "context": "Cut content, split slide, or use columns",
                })
        if not violations:
            violations.append({
                "file": str(slides_path),
                "check": "TYPST-OVERFLOW",
                "severity": "error",
                "found": "Overflow detected",
                "expected": "No overflow",
                "context": result.stdout[:200] if result.stdout else "Run check-overflow.sh for details",
            })
        return violations

    return []  # Exit 0 = no overflow


if __name__ == "__main__":
    import sys
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        print(json.dumps(results, indent=2))
        sys.exit(1)
    else:
        print("No overflow detected.")
        sys.exit(0)
