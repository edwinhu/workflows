#!/usr/bin/env -S uv run python3
"""Constraint: progress-gating — 5+ iterations without progress → STOP and escalate."""
import re
import sys
from pathlib import Path

CONSTRAINT = "progress-gating"
APPLIES_TO = ["writing", "writing-setup", "writing-outline", "writing-draft",
               "writing-validate", "writing-review", "writing-revise",
               "writing-precis-reviewer", "writing-outline-reviewer"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    planning = cwd / ".planning"
    if not planning.is_dir():
        return violations

    # Check REVIEW_STATE.md for iteration count
    review_state = planning / "REVIEW_STATE.md"
    if review_state.exists():
        content = review_state.read_text()
        # Extract iteration count from YAML frontmatter
        iteration_match = re.search(r"iteration:\s*(\d+)", content)
        max_match = re.search(r"max_iterations:\s*(\d+)", content)
        verdict_match = re.search(r"verdict:\s*(\w+)", content)
        if iteration_match:
            iteration = int(iteration_match.group(1))
            max_iter = int(max_match.group(1)) if max_match else 3
            verdict = verdict_match.group(1) if verdict_match else ""
            if iteration >= max_iter and verdict not in ("COMPLETE", "ESCALATE"):
                violations.append(
                    f"REVIEW_STATE.md shows iteration {iteration} >= max {max_iter} "
                    f"but verdict is '{verdict}' (expected COMPLETE or ESCALATE) — "
                    "progress-gating requires escalation after max iterations"
                )

    # Check ACTIVE_WORKFLOW.md for stuck iterations
    active = planning / "ACTIVE_WORKFLOW.md"
    if active.exists():
        content = active.read_text()
        iter_match = re.search(r"edits_since_verify:\s*(\d+)", content)
        threshold_match = re.search(r"verify_threshold:\s*(\d+)", content)
        if iter_match and threshold_match:
            edits = int(iter_match.group(1))
            threshold = int(threshold_match.group(1))
            if edits > threshold * 2:
                violations.append(
                    f"ACTIVE_WORKFLOW.md shows {edits} edits since verify "
                    f"(threshold: {threshold}) — possible stuck loop, "
                    "consider escalating or running verification"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
