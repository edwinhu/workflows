#!/usr/bin/env -S uv run python3
"""PostToolUse hook: Run overflow detection after typst compile.

Fires on Bash tool calls that contain 'typst compile' and a .typ file.
Runs check-overflow.sh and reports results as additional context.

Non-blocking: reports overflow as messages so the agent can fix it.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


def find_plugin_root() -> Path | None:
    """Find the workflows plugin root."""
    # Try relative to this hook file
    hook_dir = Path(__file__).resolve().parent
    candidate = hook_dir.parent
    if (candidate / ".claude-plugin" / "plugin.json").exists():
        return candidate
    return None


TRIGGER_RE = re.compile(r'\b(?:typst|tinymist)\s+compile\b')


def resolve_typ_target(command: str) -> str | None:
    """Return the .typ compile target in `command`, or None if this isn't a typst/tinymist compile.

    Triggers on both `typst compile` and `tinymist compile`. Tolerates flags between "compile" and
    the target (e.g. `typst compile --input handout=true slides.typ`, `--root .`) by taking the LAST
    `*.typ` token in the ;/&/|-delimited segment that contains the trigger, rather than requiring the
    target to be the first token after "compile".
    """
    for seg in re.split(r'[;&|]+', command):
        if TRIGGER_RE.search(seg):
            typ_tokens = re.findall(r'([^\s]+\.typ)\b', seg)
            if typ_tokens:
                return typ_tokens[-1]
    return None


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name != "Bash":
        sys.exit(0)

    command = tool_input.get("command", "")

    # Trigger on both `typst compile` and `tinymist compile` (the compiler the workshop-generate
    # ultracode workflow and visual-verify actually invoke), tolerating flags before the target —
    # a substring check on "typst compile" alone silently skipped every tinymist-driven compile, and
    # requiring the target as the first token after "compile" missed `--input`/`--root` forms.
    typ_file = resolve_typ_target(command)
    if not typ_file:
        sys.exit(0)

    # Only check slides files (not notes.typ or other .typ files)
    if "slides" not in Path(typ_file).stem:
        sys.exit(0)

    # Find the check script
    plugin_root = find_plugin_root()
    if not plugin_root:
        sys.exit(0)

    check_script = plugin_root / "scripts" / "checks" / "check-overflow.sh"
    if not check_script.exists():
        sys.exit(0)

    # Determine the working directory from the command
    # Look for cd commands before typst compile
    cwd_match = re.search(r'cd\s+([^\s;&]+)', command)
    cwd = cwd_match.group(1) if cwd_match else "."

    # Resolve the slides path
    slides_path = Path(cwd).expanduser() / typ_file
    if not slides_path.exists():
        # Try without cd prefix
        slides_path = Path(typ_file).expanduser()
        if not slides_path.exists():
            sys.exit(0)

    try:
        result = subprocess.run(
            ["bash", str(check_script), str(slides_path)],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(slides_path.parent),
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        sys.exit(0)

    if result.returncode == 1 and result.stdout:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"OVERFLOW DETECTED in {typ_file}:\n{result.stdout.strip()}\n\nFix: cut content, split slides, or use columns. Then recompile.",
            }
        }
        print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
