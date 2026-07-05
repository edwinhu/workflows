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

The shared CLI/hook shell (validate_plan + deny + main dispatch) lives in
hooks/_plan_guard_common.py — this file supplies only the ds-specific config.

Wired via ds-plan frontmatter (the orchestrator that writes PLAN_REVIEWED.md):
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/ds-plan-executable-guard.py

Standalone:  uv run python3 ds-plan-executable-guard.py path/to/PLAN.md
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _plan_guard_common import PlanGuardConfig, run  # noqa: E402


def _deny_reason(plan_path: Path, violations: list[str]) -> str:
    return (
        "GATE BLOCKED: ds PLAN.md is not machine-executable, so it cannot be "
        "approved for implementation.\n\n"
        f"`{plan_path}` problems:\n- " + "\n- ".join(violations) + "\n\n"
        "ds-implement reads the Task Breakdown table to build the data-flow DAG "
        "and per-task Verify gates. Fix the table (see ds-plan — Task | Deps | "
        "Outputs | Expected Output | Verify | Implements), then re-run the plan "
        "reviewer. Do NOT record tasks as prose `### Task N` headers."
    )


CONFIG = PlanGuardConfig(
    hooks_dir=Path(__file__).resolve().parent,
    scripts_subdir="ds",
    parser_module="ds_plan_table",
    table_label="Task Breakdown",
    deny_reason=_deny_reason,
)


if __name__ == "__main__":
    run(CONFIG)
