#!/usr/bin/env python3
"""Constraint: wc-state-frontmatter — STATE.md must include requires/provides/affects."""

CONSTRAINT = "wc-state-frontmatter"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "soft"

import sys
from pathlib import Path


def check(context):
    """Check that SKILL.md STATE.md templates include summary frontmatter fields."""
    violations = []
    cwd = Path(context.get("cwd", "."))

    skill_file = cwd / "skills" / "workflow-creator" / "SKILL.md"
    if not skill_file.exists():
        return violations

    content = skill_file.read_text()

    required_fields = ["requires:", "provides:", "affects:"]

    # Find all STATE.md update blocks (look for "step:" followed by "status: completed")
    import re
    state_blocks = list(re.finditer(r'step:\s*\S+.*?status:\s*completed', content, re.DOTALL))

    for block in state_blocks:
        start = max(0, block.start() - 200)
        end = min(len(content), block.end() + 200)
        context_text = content[start:end]

        step_match = re.search(r'step:\s*(\S+)', context_text)
        step_name = step_match.group(1) if step_match else "unknown"

        missing = [f for f in required_fields if f not in context_text]
        if missing:
            violations.append(
                f"STATE.md update for step '{step_name}' missing fields: {', '.join(missing)}"
            )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
