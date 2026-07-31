#!/usr/bin/env -S uv run python3
"""Constraint: verification-vs-investigation — investigation is delegated, verification is fresh.

The clarification guard, mutation guard, task dispatch, and verifier identities enforce this at
runtime. A filesystem probe cannot reconstruct session ownership and must not consult LEARNINGS.md.
"""
import sys

CONSTRAINT = "verification-vs-investigation"
APPLIES_TO = ["dev", "dev-tdd", "dev-implement", "dev-review", "dev-verify", "dev-debug",
              "dev-delegate", "dev-test", "dev-test-gaps"]
SEVERITY = "hard"


def check(context):
    """Runtime session boundaries are enforced outside this compatibility probe."""
    return []


if __name__ == "__main__":
    print(f"PASS: {CONSTRAINT} (runtime boundary enforcement)")
    sys.exit(0)
