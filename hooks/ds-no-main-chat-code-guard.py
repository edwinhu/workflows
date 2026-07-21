#!/usr/bin/env -S uv run python3
"""PreToolUse guard: block Write/Edit/Bash on analysis files in main chat during ds-implement.

The Iron Law: YOU MUST NOT WRITE ANALYSIS CODE IN MAIN CHAT.
Analysis code must be written by delegated subagents, not the orchestrator.
"""
import json
import os
import sys
from pathlib import Path

# PreToolUse has NO top-level `decision` field -- gates go through
# hookSpecificOutput.permissionDecision. Emitting {"decision": ...} gets the whole
# payload rejected by the harness ("Hook JSON output validation failed"), silently
# disabling this guard. Use the shared helpers.
HOOKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HOOKS_DIR))
from _gate_common import allow, deny  # noqa: E402


def main():
    tool_input = json.loads(sys.stdin.read())
    tool_name = tool_input.get("tool_name", "")
    tool_params = tool_input.get("tool_input", {})

    # Only check Write, Edit, and Bash
    if tool_name not in ("Write", "Edit", "Bash"):
        allow()

    # For Bash, check if command contains analysis-related operations
    if tool_name == "Bash":
        command = tool_params.get("command", "")
        # Allow git, ls, cat .planning/, check-all-ds.sh, and other orchestration commands
        safe_prefixes = ["git ", "ls ", "cat .planning/", "head ", "tail ", "wc ", "mkdir ", "chmod ", "bash scripts/"]
        if any(command.strip().startswith(p) for p in safe_prefixes):
            allow()
        # Allow pixi/python commands that are just running scripts
        if "check-all-ds" in command or "check-ds-" in command:
            allow()
        # Block python/pixi run commands that look like analysis
        if any(kw in command for kw in ["python3 -c", "pixi run python", "import pandas", "import numpy"]):
            deny("🛑 Iron Law: No analysis code in main chat. Delegate to a subagent via ds-delegate.")
        allow()

    # For Write/Edit, check if target is an analysis file
    path = tool_params.get("file_path", "")

    # Allow writes to state files, planning, config
    allowed_patterns = [".planning/", ".claude/", "CLAUDE.md", "scripts/", "hooks/", "references/", "skills/"]
    if any(pattern in path for pattern in allowed_patterns):
        allow()

    # Block writes to analysis files (.py, .ipynb, .R, .sas, .sql in project dirs)
    analysis_extensions = [".py", ".ipynb", ".R", ".r", ".sas", ".sql", ".qmd"]
    if any(path.endswith(ext) for ext in analysis_extensions):
        deny("🛑 Iron Law: No analysis code in main chat. This file should be written by a delegated subagent. Use ds-delegate to dispatch a Task agent.")

    allow()

if __name__ == "__main__":
    main()
