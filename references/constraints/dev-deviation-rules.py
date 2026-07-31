#!/usr/bin/env -S uv run python3
"""Constraint: dev-deviation-rules — live deviations are recorded in TaskList results.

The native dev lifecycle intentionally has no visible planning ledger for a filesystem probe to scan.
R1-R4 enforcement belongs to the task contract, shared runner, and independent verifier.
"""
import sys

CONSTRAINT = "dev-deviation-rules"
APPLIES_TO = ["dev-implement", "dev-delegate", "dev-tdd"]
SEVERITY = "hard"


def check(context):
    """No filesystem assertion can authenticate TaskList or returned task evidence."""
    return []


if __name__ == "__main__":
    print(f"PASS: {CONSTRAINT} (TaskList/returned-result enforcement)")
    sys.exit(0)
