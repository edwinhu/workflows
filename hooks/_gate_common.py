#!/usr/bin/env -S uv run python3
"""Shared helpers for the PreToolUse mechanical-floor/mechanical-gate hooks
(hooks/mechanical-floor-gate.py FLOOR=dev/ds, hooks/writing-mechanical-gate.py).

`deny` and `_project_from_args` were duplicated byte-for-byte across both
hooks; this module is the single source of truth for them. Each hook still
runs standalone as a script (`uv run python3 <path>`, invoked from whatever
cwd the harness happens to be in) — see the sys.path-insert import pattern in
either hook file for how to import this module reliably regardless of cwd.
"""
import json
import sys
from typing import Optional


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def _project_from_args(tool_input: dict, hook_input: Optional[dict] = None) -> str:
    """Resolve the project directory the gate should audit.

    `args.projectDir` is only ever populated on `Workflow` tool calls — `Agent`
    tool calls (e.g. the dev-verify goal-backward verifier, FLOOR=dev) NEVER
    carry it. Without a fallback, FLOOR=dev always audited "." — the hook
    process's own cwd, not the project actually being worked on — silently
    no-oping the gate. Falls back to the hook payload's top-level `cwd` (which
    Claude Code always sets for PreToolUse hooks), then "." as a last resort.
    """
    args = tool_input.get("args")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    if isinstance(args, dict) and args.get("projectDir"):
        return str(args["projectDir"])
    if hook_input and hook_input.get("cwd"):
        return str(hook_input["cwd"])
    return "."
