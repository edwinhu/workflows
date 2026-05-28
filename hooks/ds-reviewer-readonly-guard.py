#!/usr/bin/env -S uv run python3
"""PreToolUse guard: block Write/Edit during review phases.

Review agents should be read-only. This hook blocks Write and Edit
tool calls to prevent reviewers from "fixing" issues they find.
"""
import json
import sys

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
            print(json.dumps({"decision": "allow"}))
            return
        print(json.dumps({
            "decision": "block",
            "message": "\ud83d\uded1 Reviewer read-only enforcement: Review/verification agents must NOT modify files. Report findings back to the orchestrator for planned fixes. (Writes to .planning/ verdict sentinels are allowed.)"
        }))
    else:
        print(json.dumps({"decision": "allow"}))

if __name__ == "__main__":
    main()
