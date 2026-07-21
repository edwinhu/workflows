#!/usr/bin/env -S uv run python3
"""PreToolUse guard: block Write/Edit during review phases.

Review agents should be read-only. This hook blocks Write and Edit
tool calls to prevent reviewers from "fixing" issues they find.
"""
import json
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

    if tool_name in ("Write", "Edit"):
        # Allow workflow-state writes (verdict sentinels under .planning/.claude).
        # The guard's intent is to stop reviewers "fixing" the artifact under review
        # or project code \u2014 NOT to block writing a verdict sentinel like
        # .planning/SPEC_REVIEWED.md. Mirrors phase-gate-guard's allowlist.
        path = tool_input.get("tool_input", {}).get("file_path", "")
        parts = [p for p in path.replace("\\", "/").split("/") if p and p != "."]
        if parts and parts[0] in (".planning", ".claude"):
            allow()
        deny("\ud83d\uded1 Reviewer read-only enforcement: Review/verification agents must NOT modify files. Report findings back to the orchestrator for planned fixes. (Writes to .planning/ verdict sentinels are allowed.)")
    else:
        allow()

if __name__ == "__main__":
    main()
