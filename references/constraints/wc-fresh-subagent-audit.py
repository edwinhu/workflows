#!/usr/bin/env -S uv run python3
"""Constraint: wc-fresh-subagent-audit — audit dispatches must use fresh subagents with read-only tools."""

CONSTRAINT = "wc-fresh-subagent-audit"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "hard"

import sys
from pathlib import Path


def check(context):
    """Check that SKILL.md contains fresh subagent audit dispatch with read-only tools."""
    violations = []
    cwd = Path(context.get("cwd", "."))

    skill_file = cwd / "skills" / "workflow-creator" / "SKILL.md"
    if not skill_file.exists():
        return violations  # not in plugin root

    content = skill_file.read_text()

    import re

    # An audit dispatch is fresh + read-only if EITHER:
    #  (a) it dispatches a fresh Agent() with an allowed_tools restriction (the original pattern), OR
    #  (b) it invokes the wc-audit dynamic workflow (whose dimension reviewers are READ-ONLY
    #      subagents by construction and whose composite is computed in JS — the migrated pattern).
    def fresh_readonly(section):
        agent_form = ("Agent(" in section or "subagent" in section.lower()) and (
            "allowed_tools" in section or "allowed-tools" in section)
        workflow_form = "wc-audit" in section
        return agent_form or workflow_form

    # Check Mode 1 Step 7 has a fresh, read-only audit dispatch (use heading pattern)
    step7_match = re.search(r'^### Step 7:', content, re.MULTILINE)
    if step7_match:
        step7_section = content[step7_match.start():step7_match.start() + 3000]
        if not fresh_readonly(step7_section):
            violations.append("Step 7 audit dispatch is neither a read-only Agent() nor a wc-audit workflow call")

    # Check Mode 3 Phase A has a fresh, read-only audit dispatch (use heading pattern)
    phase_a_match = re.search(r'^#### Phase A:', content, re.MULTILINE)
    if phase_a_match:
        phase_a_section = content[phase_a_match.start():phase_a_match.start() + 3000]
        if not fresh_readonly(phase_a_section):
            violations.append("Phase A audit dispatch is neither a read-only Agent() nor a wc-audit workflow call")

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
