#!/usr/bin/env -S uv run python3
"""
PreToolUse hook (visual-verify scoped): Auto-inject find-slide-page output
before any tinymist compile targeting a Touying .typ slide file.

When an agent is about to compile a .typ file for visual verification, this
hook runs find-slide-page in pres mode and prints the full heading→page map
as a system message. The agent sees exact page numbers before the compile
result lands, breaking the guess-compile-wrong-page-retry loop.

Fires on: Bash tool calls containing "tinymist compile" + a slides/*.typ target.
No-ops silently on: anything else.
"""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
from pathlib import Path


TRIGGER_RE = re.compile(
    # Any *.typ compile target, not just one under a literal `slides/` directory — workshop decks
    # commonly compile `presentation/slides.typ` or a flat `slides.typ`, neither of which matched the
    # old `slides/\S+\.typ` requirement. The find_scripts_dir() teaching-plugin lookup below stays the
    # graceful no-op for machines without it — that part is by design, not part of this fix.
    r"tinymist\s+compile\b.*?\b(\S+\.typ)\b",
)


def find_scripts_dir() -> str | None:
    """Find the most recent course-materials teaching plugin scripts dir."""
    pattern = os.path.expanduser(
        "~/.claude/plugins/cache/course-materials/teaching/*/scripts"
    )
    matches = sorted(glob.glob(pattern))
    return matches[-1] if matches else None


def run_find_slide_page(scripts_dir: str, target: str, cwd: str) -> str | None:
    """Run find-slide-page in pres mode for the given target, return output."""
    fsp_typ = os.path.join(scripts_dir, "find-slide-page.typ")
    val_typ = os.path.join(scripts_dir, "validation.typ")
    extract_py = os.path.join(scripts_dir, "extract-headings.py")

    if not all(os.path.exists(p) for p in [fsp_typ, val_typ, extract_py]):
        return None

    # Copy query files to output/ (mirrors the skill's own workflow)
    out_dir = os.path.join(cwd, "output")
    os.makedirs(out_dir, exist_ok=True)
    import shutil
    shutil.copy2(fsp_typ, out_dir)
    shutil.copy2(val_typ, out_dir)

    try:
        query_result = subprocess.run(
            [
                "typst", "query",
                "--root", ".",
                "output/find-slide-page.typ",
                "<val>",
                "--field", "value",
                f"--input=target={target}",
                "--input=mode=pres",
            ],
            capture_output=True, text=True, cwd=cwd, timeout=60,
        )
        if query_result.returncode != 0 or not query_result.stdout.strip():
            return None

        extract_result = subprocess.run(
            ["uv", "run", "python3", extract_py],
            input=query_result.stdout,
            capture_output=True, text=True, timeout=10,
        )
        return extract_result.stdout.strip() or None
    except Exception:
        return None
    finally:
        for f in ["find-slide-page.typ", "validation.typ"]:
            try:
                os.unlink(os.path.join(out_dir, f))
            except OSError:
                pass


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if hook_input.get("tool_name") != "Bash":
        sys.exit(0)

    command = hook_input.get("tool_input", {}).get("command", "")
    m = TRIGGER_RE.search(command)
    if not m:
        sys.exit(0)

    target = m.group(1)
    cwd = os.getcwd()

    # Only act on files that actually exist (skip generated/temp targets)
    if not os.path.exists(os.path.join(cwd, target)):
        sys.exit(0)

    scripts_dir = find_scripts_dir()
    if not scripts_dir:
        sys.exit(0)

    page_map = run_find_slide_page(scripts_dir, target, cwd)
    if not page_map:
        sys.exit(0)

    print(f"=== find-slide-page (pres mode): {target} ===")
    print(page_map)
    print(f"=== Use these page numbers — do NOT guess or estimate ===")


if __name__ == "__main__":
    main()
