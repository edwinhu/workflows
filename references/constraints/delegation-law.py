#!/usr/bin/env -S uv run python3
"""Constraint: delegation-law — project mutations use reviewed delegated execution.

Real-time enforcement is provided by orchestrator-mutation-guard and the shared implementation
runner. Filesystem state cannot identify which session performed an edit, so this probe deliberately
does not infer authorship from retired planning ledgers or an uncommitted diff.
"""
import sys

CONSTRAINT = "delegation-law"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-verify", "dev-accept", "dev-debug",
              "dev-delegate", "dev-design", "dev-explore", "dev-handoff", "dev-test",
              "dev-test-gaps", "dev-plan-reviewer"]
SEVERITY = "hard"


def check(context):
    """The deterministic hook and runner own this constraint."""
    return []


if __name__ == "__main__":
    print(f"PASS: {CONSTRAINT} (hook/runner enforcement)")
    sys.exit(0)
