#!/usr/bin/env -S uv run python3
"""Constraint: wc-state-frontmatter — STATE.md must include requires/provides/affects."""

CONSTRAINT = "wc-state-frontmatter"
APPLIES_TO = ["workflow-creator"]
SEVERITY = "soft"

import re
import sys
from pathlib import Path


def strip_fenced_blocks(content):
    """Remove code-fenced blocks (```...```) to avoid matching template examples."""
    return re.sub(r'```.*?```', '', content, flags=re.DOTALL)


def check(context):
    """Check that real STATE.md update instructions include summary frontmatter fields."""
    violations = []
    cwd = Path(context.get("cwd", "."))

    skill_file = cwd / "skills" / "workflow-creator" / "SKILL.md"
    if not skill_file.exists():
        return violations

    content = skill_file.read_text()

    required_fields = ["requires:", "provides:", "affects:"]

    # Find YAML code blocks that contain STATE.md updates (the real templates)
    # These are ```yaml blocks with step: and status: completed
    yaml_blocks = list(re.finditer(
        r'```yaml\n(.*?)```',
        content,
        re.DOTALL
    ))

    state_updates = []
    for block in yaml_blocks:
        block_text = block.group(1)
        if 'step:' in block_text and 'status: completed' in block_text:
            step_match = re.search(r'step:\s*(\S+)', block_text)
            step_name = step_match.group(1) if step_match else "unknown"
            state_updates.append((step_name, block_text))

    # Also check inline STATE.md updates (not in YAML blocks)
    # Pattern: "Update .planning/wc/{name}/STATE.md:" followed by step/status
    inline_updates = re.finditer(
        r'Update.*STATE\.md.*?`step:\s*(\S+?),\s*status:\s*completed`',
        content
    )
    for match in inline_updates:
        step_name = match.group(1)
        # Inline updates can't have frontmatter — flag them
        state_updates.append((step_name, match.group(0)))

    for step_name, block_text in state_updates:
        # Skip example/template text in EXTREMELY-IMPORTANT blocks
        if step_name in ('N-name,', 'N-name'):
            continue

        missing = [f for f in required_fields if f not in block_text]
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
