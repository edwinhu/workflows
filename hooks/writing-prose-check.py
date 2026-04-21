#!/usr/bin/env -S uv run python3
"""PostToolUse hook: Run constraint checks after draft edits.

Fires on Edit|Write to drafts/*.md files. Delegates to check-all.py
(single discovery path) and filters violations to the edited file.

Non-blocking: reports violations as additionalContext messages.
"""
from __future__ import annotations

import json
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
    file_violations = []
    for entry in results.get("failed", []):
        for v in entry.get("violations", []):
            if f"drafts/{edited_name}:" in v:
                file_violations.append(v)

    if not file_violations:
        sys.exit(0)

    output = "Prose quality violations:\n" + "\n".join(f"  • {v}" for v in file_violations)
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
