#!/usr/bin/env -S uv run python3
"""Constraint: structural-vs-runtime-verification — runtime evidence is required.

Fresh runtime evidence lives in TaskList findings and returned verification results, not visible
planning files. The dev test-gap, review, and verify skills perform the substantive check.
"""
import sys

CONSTRAINT = "structural-vs-runtime-verification"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-review", "dev-verify", "dev-debug",
              "dev-test", "dev-test-gaps"]
SEVERITY = "hard"


def check(context):
    """No retired filesystem ledger is authoritative verification evidence."""
    return []


if __name__ == "__main__":
    print(f"PASS: {CONSTRAINT} (fresh verifier enforcement)")
    sys.exit(0)
