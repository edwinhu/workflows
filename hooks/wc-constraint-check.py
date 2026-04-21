#!/usr/bin/env -S uv run python3
"""PostToolUse hook: runs wc-* constraint checks after edits to workflow-creator files."""

import importlib.util
import json
import sys
from pathlib import Path

WC_PATHS = ("skills/workflow-creator/", "references/constraints/wc-")

REPO_ROOT = Path(__file__).parent.parent
CONSTRAINTS_DIR = REPO_ROOT / "references" / "constraints"


def import_check(py_path):
    spec = importlib.util.spec_from_file_location(py_path.stem, py_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    if tool_name not in ("Write", "Edit"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not any(segment in file_path for segment in WC_PATHS):
        sys.exit(0)

    context = {"cwd": str(REPO_ROOT)}
    failures = []

    for py_path in sorted(CONSTRAINTS_DIR.glob("wc-*.py")):
        try:
            mod = import_check(py_path)
            violations = mod.check(context)
            if violations:
                failures.extend(f"{py_path.stem}: {v}" for v in violations)
        except Exception:
            pass

    if failures:
        msg = "Constraint violations after edit:\n" + "\n".join(f"  - {f}" for f in failures)
        result = {"hookSpecificOutput": {"hookEventName": "PostToolUse", "outputToUser": msg}}
        print(json.dumps(result))

    sys.exit(0)


if __name__ == "__main__":
    main()
