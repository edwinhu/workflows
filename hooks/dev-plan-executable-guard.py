#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block PLAN_REVIEWED.md approval unless PLAN.md carries a
machine-EXECUTABLE Implementation Order table.

`dev-compile` turns the Implementation Order table into `.planning/run.js`, which
topologically sorts `Deps` into dependency levels, runs each level's tasks
sequentially (shared tree, TDD test-first), and gates each task on its
`Verify Command` exit code via an independent probe. A plan that records the work
as prose phase-headings (or leaves Deps/Files/Verify Command blank) is NOT
compilable — neither a DAG nor a per-task gate can be parsed out of it. This guard
imports the SAME parser dev-compile uses (scripts/dev/dev_plan_table.py), so a plan
that compiles also passes this gate, and vice-versa.

This guard fires when something writes `.planning/PLAN_REVIEWED.md` (the approval
artifact dev-implement's gate checks). It validates the sibling PLAN.md's table
and DENIES the approval write if the table is missing or any row is incomplete.
Instructional "use the table" text was systematically ignored (a real reviewed
PLAN — happy-clawd — used prose phase-headings and passed); the hook is the
structural enforcement.

The shared CLI/hook shell (validate_plan + deny + main dispatch) lives in
hooks/_plan_guard_common.py — this file supplies only the dev-specific config.

Wired via dev-design frontmatter (skills/dev-design/SKILL.md — dev-plan-reviewer is a read-only
reviewer and never writes PLAN_REVIEWED.md, so it cannot be this hook's wiring point):
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-plan-executable-guard.py

Standalone:  uv run python3 dev-plan-executable-guard.py path/to/PLAN.md
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _plan_guard_common import PlanGuardConfig, run  # noqa: E402


def _deny_reason(plan_path: Path, violations: list[str]) -> str:
    return (
        "GATE BLOCKED: PLAN.md is not machine-executable, so it cannot be "
        "approved for implementation.\n\n"
        f"`{plan_path}` problems:\n- " + "\n- ".join(violations) + "\n\n"
        "dev-implement reads the Implementation Order table to build the "
        "dependency DAG and per-task verify gates. Fix the table (see "
        "dev-design/references/plan-template.md — Task | Deps | Files | "
        "Failing Test | Verify Command | Implements), then re-run the plan "
        "reviewer. Do NOT record tasks as prose phase-headings."
    )


CONFIG = PlanGuardConfig(
    hooks_dir=Path(__file__).resolve().parent,
    scripts_subdir="dev",
    parser_module="dev_plan_table",
    table_label="Implementation Order",
    deny_reason=_deny_reason,
)


if __name__ == "__main__":
    run(CONFIG)
