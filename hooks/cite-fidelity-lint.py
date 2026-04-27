#!/usr/bin/env -S uv run python3
"""PostToolUse hook: lint a freshly-written drafts/*.md for cite-fidelity issues.

Fires after Edit|Write of a markdown file inside the writing project's
drafts/ directory. Runs Stage 4 lint (handcite + bundled + bibkey-not-in-nlm
unless ACTIVE_WORKFLOW.md has no notebook) and surfaces findings as a
non-blocking stderr warning visible in the conversation.

Always defaults to approve — never blocks tool calls. The hook's job is to
nudge the agent toward Stage 2 grounding, not to refuse edits.

Skipped when:
- No file_path in tool_input
- Edited file is not under drafts/
- ACTIVE_WORKFLOW.md is unreachable (cite-fidelity not configured)
- Any unexpected error (defensive default-approve)
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        return 0

    tool_name = hook_input.get("tool_name", "")
    if tool_name not in ("Edit", "Write", "MultiEdit"):
        return 0

    tool_input = hook_input.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path", "")
    if not file_path:
        return 0

    fp = Path(file_path)
    if fp.suffix != ".md":
        return 0
    if "drafts" not in fp.parts:
        return 0

    plugin_root = Path(__file__).resolve().parent.parent
    lint_script = plugin_root / "scripts" / "cite-fidelity" / "lint_drafts.py"
    if not lint_script.exists():
        return 0

    project_dir = fp.parent
    while project_dir != project_dir.parent:
        if (project_dir / ".planning" / "ACTIVE_WORKFLOW.md").exists():
            break
        project_dir = project_dir.parent
    else:
        return 0

    try:
        result = subprocess.run(
            ["uv", "run", "python3", str(lint_script), str(fp)],
            capture_output=True, text=True, timeout=60,
            cwd=str(project_dir),
        )
    except Exception:
        return 0

    out = (result.stdout or "").strip()
    err = (result.stderr or "").strip()
    if not out and not err:
        return 0
    if "✓ no issues" in out:
        return 0

    lines = ["[cite-fidelity-lint] findings on " + fp.name + ":"]
    if out:
        lines.append(out)
    if err:
        lines.append(err)
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n".join(lines),
        }
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
