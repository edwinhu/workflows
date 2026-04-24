#!/usr/bin/env -S uv run python3
"""PostToolUse hook: Run constraint checks after draft edits.

Fires on Edit|Write to drafts/*.md files. Delegates to check-all.py
(single discovery path) and filters violations to the edited file AND
the line range the edit actually touched (±2 lines for boundary issues).
This prevents every edit from surfacing pre-existing warnings on unrelated
lines.

Non-blocking: reports violations as additionalContext messages.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).parent.parent
CHECK_ALL = PLUGIN_ROOT / "references" / "constraints" / "check-all.py"


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
    if not file_path:
        sys.exit(0)

    path = Path(file_path)

    if path.suffix.lower() != ".md" or path.parent.name != "drafts":
        sys.exit(0)

    project_root = str(path.parent.parent)

    try:
        proc = subprocess.run(
            [sys.executable, str(CHECK_ALL), project_root],
            capture_output=True, text=True, timeout=30
        )
        # check-all.py outputs JSON then a summary line; extract the JSON object
        raw = proc.stdout.strip()
        brace_depth = 0
        json_end = 0
        for i, ch in enumerate(raw):
            if ch == "{":
                brace_depth += 1
            elif ch == "}":
                brace_depth -= 1
                if brace_depth == 0:
                    json_end = i + 1
                    break
        results = json.loads(raw[:json_end]) if json_end else {}
    except Exception:
        sys.exit(0)

    edited_name = path.name
    # Scope to line ranges the edit actually touched. For Edit: find the
    # new_string in the post-edit file and take its line span. For Write:
    # the whole file was rewritten, so report everything in it.
    edit_ranges: list[tuple[int, int]] = []
    if tool_name == "Write":
        edit_ranges = [(1, 10**9)]
    else:
        new_string = tool_input.get("new_string", "")
        if new_string and path.exists():
            try:
                file_text = path.read_text()
            except Exception:
                file_text = ""
            idx = file_text.find(new_string)
            while idx != -1:
                start_line = file_text.count("\n", 0, idx) + 1
                end_line = start_line + new_string.count("\n")
                # Pad ±2 lines to catch issues the edit may have introduced
                # around its boundary.
                edit_ranges.append((max(1, start_line - 2), end_line + 2))
                idx = file_text.find(new_string, idx + 1)
        if not edit_ranges:
            # Fallback: edit text not locatable → report file-wide.
            edit_ranges = [(1, 10**9)]

    line_re = re.compile(rf"drafts/{re.escape(edited_name)}:(\d+):")
    file_violations = []
    for entry in results.get("failed", []):
        for v in entry.get("violations", []):
            m = line_re.search(v)
            if not m:
                continue
            line_no = int(m.group(1))
            if any(a <= line_no <= b for a, b in edit_ranges):
                file_violations.append(v)

    if not file_violations:
        sys.exit(0)

    output = "Prose quality violations (scoped to edited lines):\n" + "\n".join(f"  • {v}" for v in file_violations)
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": output,
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    main()
