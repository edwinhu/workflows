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

Wired via dev-plan-reviewer frontmatter:
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/dev-plan-executable-guard.py

Standalone:  uv run python3 dev-plan-executable-guard.py path/to/PLAN.md
"""

import json
import sys
from pathlib import Path

# Single source of truth for "what the Implementation Order table means" — the SAME tolerant
# parser dev-compile uses to emit run.js, so a plan that COMPILES also PASSES this gate.
# (Before reconciliation this guard used a stricter regex — `^(\d+)\.` ids, `^after\s+([\d,\s]+)$`
# deps — whose drift the now-retired LLM discovery agent silently tolerated: a plan the workflow
# could run could still be falsely blocked here, AND the guard's DAG check ran on a different
# interpretation than the runner's. The shared parser closes both gaps.)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "dev"))
from dev_plan_table import parse_plan  # noqa: E402


def validate_plan(plan_path: Path):
    """Return list of human-readable violations ([] == executable)."""
    if not plan_path.is_file():
        return [f"PLAN.md not found at {plan_path}"]
    return parse_plan(plan_path.read_text()).violations


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    sys.exit(0)


def main():
    # Standalone CLI mode: validate a given PLAN.md, print report, exit 0/1.
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        v = validate_plan(Path(sys.argv[1]))
        if v:
            print("PLAN NOT EXECUTABLE:\n- " + "\n- ".join(v))
            sys.exit(1)
        print("PLAN executable: Implementation Order table is complete and the Deps DAG is valid.")
        sys.exit(0)

    # Hook mode.
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    file_path = hook_input.get("tool_input", {}).get("file_path", "")
    if not file_path or not file_path.endswith("PLAN_REVIEWED.md"):
        sys.exit(0)  # only guards the approval artifact

    plan_path = Path(file_path).parent / "PLAN.md"
    violations = validate_plan(plan_path)
    if violations:
        deny(
            "GATE BLOCKED: PLAN.md is not machine-executable, so it cannot be "
            "approved for implementation.\n\n"
            f"`{plan_path}` problems:\n- " + "\n- ".join(violations) + "\n\n"
            "dev-implement reads the Implementation Order table to build the "
            "dependency DAG and per-task verify gates. Fix the table (see "
            "dev-design/references/plan-template.md — Task | Deps | Files | "
            "Failing Test | Verify Command | Implements), then re-run the plan "
            "reviewer. Do NOT record tasks as prose phase-headings."
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
