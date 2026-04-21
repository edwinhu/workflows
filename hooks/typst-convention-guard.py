#!/usr/bin/env -S uv run python3
"""
PostToolUse hook: Check Typst conventions after Edit/Write on .typ files.

Fires after Edit or Write tool calls that modify .typ files.
Runs quick grep-based checks and reports violations as additional context.

Non-blocking: reports violations so the agent can fix them immediately.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


def check_file(filepath: str) -> list[str]:
    """Run convention checks on a .typ file. Returns list of violation messages."""
    path = Path(filepath)
    if not path.exists() or path.suffix != ".typ":
        return []

    try:
        content = path.read_text()
    except Exception:
        return []

    lines = content.splitlines()
    violations: list[str] = []

    # Check 1: Missing blank lines between top-level bullets
    for i, line in enumerate(lines):
        if i + 1 < len(lines):
            curr = line.rstrip()
            nxt = lines[i + 1].rstrip()
            # Two consecutive lines starting with "- " (top-level bullets)
            if re.match(r"^\s{0,1}-\s", curr) and re.match(r"^\s{0,1}-\s", nxt):
                violations.append(
                    f"Line {i + 1}: Missing blank line between top-level bullets"
                )

    # Check 2: Fake sub-bullets using -- as marker
    for i, line in enumerate(lines):
        if re.match(r"^\s+--\s", line):
            violations.append(
                f"Line {i + 1}: Fake sub-bullet using '--'. Use two-space indent + '- ' instead"
            )

    # Check 3: cetz-plot import (banned)
    for i, line in enumerate(lines):
        if "cetz-plot" in line:
            violations.append(
                f"Line {i + 1}: cetz-plot import detected. Use #table() instead"
            )

    # Check 4: Missing qr: none in config-info (slides only)
    if "slides" in path.stem:
        if "config-info" in content and "qr:" not in content:
            violations.append("Missing 'qr: none' in config-info block")

    # Check 5: Uncentered images
    for i, line in enumerate(lines):
        if "#image(" in line and "align(center)" not in line:
            # Check if previous line has align(center)
            if i == 0 or "align(center)" not in lines[i - 1]:
                violations.append(
                    f"Line {i + 1}: #image() not wrapped in #align(center)"
                )

    # Check 6: Smart apostrophe issues
    for i, line in enumerate(lines):
        if re.search(r"[)\]]'s", line):
            violations.append(
                f"Line {i + 1}: Smart apostrophe issue. Use \\u{{2019}}s instead of )'s or ]'s"
            )

    # Check 7: Unescaped dollar signs before numbers
    for i, line in enumerate(lines):
        if re.search(r"[^\\]\$\d", line):
            violations.append(
                f"Line {i + 1}: Unescaped dollar sign. Use \\$ instead of $"
            )

    # Check 8: Table inset too small
    for i, line in enumerate(lines):
        inset_match = re.search(r"inset:\s*(\d+)pt", line)
        if inset_match and int(inset_match.group(1)) < 10:
            violations.append(
                f"Line {i + 1}: Table inset {inset_match.group(1)}pt is too small. Use 10pt minimum"
            )

    # Check 9: cetz canvas without minimum length
    for i, line in enumerate(lines):
        length_match = re.search(r"length:\s*(\d+(?:\.\d+)?)(cm|mm|pt|em)", line)
        if length_match and "cetz" in content:
            val = float(length_match.group(1))
            unit = length_match.group(2)
            if unit == "em" and val < 2:
                violations.append(
                    f"Line {i + 1}: CeTZ canvas length {val}{unit} is too small. Use 2em minimum"
                )
            elif unit in ("cm", "mm"):
                violations.append(
                    f"Line {i + 1}: CeTZ canvas uses {unit}. Use em units (minimum 2em)"
                )

    # Limit to first 5 violations to avoid overwhelming output
    return violations[:5]


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path.endswith(".typ"):
        sys.exit(0)

    violations = check_file(file_path)
    if violations:
        msg = "TYPST CONVENTION VIOLATIONS detected:\n"
        for v in violations:
            msg += f"  - {v}\n"
        msg += "\nFix these before proceeding. Every convention violation is rework for the presenter."

        output = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": msg,
            }
        }
        print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
