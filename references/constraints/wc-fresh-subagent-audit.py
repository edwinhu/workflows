#!/usr/bin/env python3
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

    # Check Mode 1 Step 7 has fresh subagent dispatch (use heading pattern)
    step7_match = re.search(r'^### Step 7:', content, re.MULTILINE)
    if step7_match:
        step7_section = content[step7_match.start():step7_match.start() + 3000]
        if "Agent(" not in step7_section and "subagent" not in step7_section.lower():
            violations.append("Step 7 does not contain Agent() dispatch for self-audit")
        if 'allowed_tools' not in step7_section and 'allowed-tools' not in step7_section:
            violations.append("Step 7 audit dispatch missing allowed_tools restriction")

    # Check Mode 3 Phase A has fresh subagent dispatch (use heading pattern)
    phase_a_match = re.search(r'^#### Phase A:', content, re.MULTILINE)
    if phase_a_match:
        phase_a_section = content[phase_a_match.start():phase_a_match.start() + 3000]
        if "Agent(" not in phase_a_section and "subagent" not in phase_a_section.lower():
            violations.append("Phase A does not contain Agent() dispatch for audit")
        if 'allowed_tools' not in phase_a_section and 'allowed-tools' not in phase_a_section:
            violations.append("Phase A audit dispatch missing allowed_tools restriction")

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
