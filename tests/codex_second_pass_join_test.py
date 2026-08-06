#!/usr/bin/env -S uv run python3
"""Native dev Codex second-pass doctrine contract.

The legacy dev loop persisted Codex launch/join state in REVIEW_STATE.md and a visible
JSON envelope. Modern dev retains that transient status in the current TaskList review
item and in the returned review result, so a launch cannot be mistaken for a verdict
and no visible planning ledger is created.
"""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REVIEW = (REPO / "skills" / "dev-verify" / "SKILL.md").read_text()
VERIFY = (REPO / "skills" / "dev-accept" / "SKILL.md").read_text()

FAILURES = []


def check(name, condition):
    print(f"{'PASS' if condition else 'FAIL'}  {name}")
    if not condition:
        FAILURES.append(name)


check("review records optional Codex state in TaskList", "TaskList item" in REVIEW)
check("review returns Codex state to caller", "Codex: {status:" in REVIEW)
check("requested status is not a verdict", "requested` must be joined before approval" in REVIEW)
check("completed, declined, and unavailable statuses are explicit", all(status in REVIEW for status in ["completed", "declined", "unavailable"]))
check("Codex findings re-enter ordinary TaskList repair", "TaskList findings" in REVIEW)
check("review forbids REVIEW_STATE ledger", "Never use `REVIEW_STATE.md`" in REVIEW)
check("review forbids visible Codex envelope", "codex-second-pass-*.json" in REVIEW)
check("verification consumes returned review result", "returned test-gap and\nreview results" in VERIFY)
check("verification forbids REVIEW_STATE ledger", "`REVIEW_STATE.md`" in VERIFY)

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILED: {FAILURES}")
    sys.exit(1)
print("native Codex second-pass doctrine tests passed")
