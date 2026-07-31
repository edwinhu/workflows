#!/usr/bin/env -S uv run python3
"""Constraint: dev-requirement-traceability — native plan IDs trace through live evidence.

The exact generated plan and TaskList are authenticated by TypeScript hooks and the shared runner.
This compatibility probe must not revive fixed SPEC, PLAN, or VALIDATION files as authority.
"""
import sys

CONSTRAINT = "dev-requirement-traceability"
APPLIES_TO = ["dev-design", "dev-plan-reviewer", "dev-implement", "dev-review", "dev-verify", "dev-test-gaps"]
SEVERITY = "hard"


def check(context):
    """Traceability is checked by plan review, test-gap audit, and fresh verification."""
    return []


if __name__ == "__main__":
    print(f"PASS: {CONSTRAINT} (native plan/TaskList enforcement)")
    sys.exit(0)
