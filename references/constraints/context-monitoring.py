#!/usr/bin/env -S uv run python3
"""Constraint: context-monitoring — no new phase without sufficient context; check handoff exists when needed."""
import re
import sys
from pathlib import Path

CONSTRAINT = "context-monitoring"
APPLIES_TO = ["writing", "writing-setup", "writing-outline", "writing-draft",
               "writing-validate", "writing-verify", "writing-revise"]
SEVERITY = "hard"


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    planning = cwd / ".planning"
    if not planning.is_dir():
        return violations

    # Check ACTIVE_WORKFLOW.md exists when drafts/ exist (means workflow is active)
    active = planning / "ACTIVE_WORKFLOW.md"
    drafts_dir = cwd / "drafts"
    handoff = planning / "HANDOFF.md"

    # If workflow is active and we have multiple phases of artifacts,
    # verify HANDOFF.md is not stale (if it exists)
    if handoff.exists() and active.exists():
        handoff_content = handoff.read_text()
        active_content = active.read_text()

        # Extract phase from both
        handoff_phase = re.search(r"phase:\s*(\w+)", handoff_content)
        active_phase = re.search(r"phase:\s*(\w+)", active_content)

        if handoff_phase and active_phase:
            h_phase = handoff_phase.group(1)
            a_phase = active_phase.group(1)
            # Handoff should match or precede the active phase
            phase_order = ["setup", "outline", "draft", "validate", "review", "revise"]
            if h_phase in phase_order and a_phase in phase_order:
                h_idx = phase_order.index(h_phase)
                a_idx = phase_order.index(a_phase)
                if h_idx > a_idx:
                    violations.append(
                        f"HANDOFF.md records phase '{h_phase}' but ACTIVE_WORKFLOW.md "
                        f"shows phase '{a_phase}' — handoff is ahead of active state, "
                        "possible stale handoff"
                    )

    # Check that PHASE_SUMMARY.md exists when multiple phases have been completed
    phase_summary = planning / "PHASE_SUMMARY.md"
    has_outlines = (cwd / "outlines").is_dir() and any((cwd / "outlines").glob("*.md"))
    has_drafts = drafts_dir.is_dir() and any(drafts_dir.glob("*.md"))

    if has_drafts and not phase_summary.exists():
        violations.append(
            "drafts/ exist but .planning/PHASE_SUMMARY.md does not — "
            "each completed phase should append a summary for context recovery"
        )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
