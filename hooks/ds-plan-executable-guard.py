#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block PLAN_REVIEWED.md approval unless the ds PLAN.md carries a
machine-EXECUTABLE Task Breakdown table.

`ds-implement` (the transform workflow) reads the Task Breakdown table directly:
it topologically sorts `Deps` (the data-flow DAG — which intermediates a task
consumes) into levels, runs each level output-first, and gates each task on its
`Verify` assertion exit code. A plan that records tasks as prose `### Task N`
headers (or leaves Deps/Outputs/Expected Output/Verify blank) is NOT executable.

This guard fires when something writes `.planning/PLAN_REVIEWED.md` (the approval
artifact ds-implement's gate checks). It validates the sibling PLAN.md's table
and DENIES the approval write if the table is missing or any row is incomplete.

Wired via ds-plan frontmatter (the orchestrator that writes PLAN_REVIEWED.md):
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-plan-executable-guard.py

Standalone:  uv run python3 ds-plan-executable-guard.py path/to/PLAN.md
"""

import json
import sys
from pathlib import Path


def validate_plan(plan_path: Path):
    """Return list of human-readable violations ([] == executable).

    Single source of truth for "what the Task Breakdown table means" — the SAME tolerant
    parser ds-compile uses to emit run.js, so a plan that COMPILES also PASSES this gate.
    (Before reconciliation this guard used a stricter regex that rejected real plans like
    muni's `**T1**` / bare-`T1` format, which only ran because the now-retired LLM discovery
    agent silently tolerated the drift. The shared parser closes that gap.)

    The parser import is deliberately LAZY (done here, not at module load): this hook's
    PreToolUse matcher fires on every Write/Edit in a session, but only a write to
    `PLAN_REVIEWED.md` ever reaches this function — the hundreds of unrelated calls exit early
    in main() before validate_plan runs. Importing ds_plan_table (and mutating sys.path) at
    module scope would pay that cost on every one of them.
    """
    if not plan_path.is_file():
        return [f"PLAN.md not found at {plan_path}"]
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ds"))
    from ds_plan_table import parse_plan  # noqa: E402
    return parse_plan(plan_path.read_text()).violations


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main():
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        v = validate_plan(Path(sys.argv[1]))
        if v:
            print("PLAN NOT EXECUTABLE:\n- " + "\n- ".join(v))
            sys.exit(1)
        print("PLAN executable: Task Breakdown table is complete and the Deps DAG is valid.")
        sys.exit(0)

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    file_path = hook_input.get("tool_input", {}).get("file_path", "")
    if not file_path or not file_path.endswith("PLAN_REVIEWED.md"):
        sys.exit(0)

    plan_path = Path(file_path).parent / "PLAN.md"
    violations = validate_plan(plan_path)
    if violations:
        deny(
            "GATE BLOCKED: ds PLAN.md is not machine-executable, so it cannot be "
            "approved for implementation.\n\n"
            f"`{plan_path}` problems:\n- " + "\n- ".join(violations) + "\n\n"
            "ds-implement reads the Task Breakdown table to build the data-flow DAG "
            "and per-task Verify gates. Fix the table (see ds-plan — Task | Deps | "
            "Outputs | Expected Output | Verify | Implements), then re-run the plan "
            "reviewer. Do NOT record tasks as prose `### Task N` headers."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
