#!/usr/bin/env -S uv run python3
"""Constraint: constraint-loading-protocol — verify prose-writing skills load domain skill + ai-anti-patterns."""

CONSTRAINT = "constraint-loading-protocol"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise", "writing-validate"]
SEVERITY = "hard"

import re
from pathlib import Path

# Skills that write/review prose must load BOTH constraint layers
PROSE_SKILLS = ['writing-draft', 'writing-verify', 'writing-revise', 'writing-validate']

# The domain skill is selected dynamically from the plan's `style` field (v5.98.0 native-Plan
# migration) — skills no longer hardcode `writing-legal/SKILL.md`. The matcher therefore accepts
# either spelling, but still requires an explicit LOAD verb bound to a domain/style referent within
# the same sentence, so deleting the loading instruction from a skill still fails the check.
DOMAIN_SKILL_PATTERN = re.compile(
    r'\bload(?:s|ed|ing)?\b[^.\n]{0,80}?'
    r'(?:domain skill'                          # "Load the domain skill [from index `style`]"
    r'|style selected'                          # "Load ..., the style selected in `## Writing Intent`"
    r'|writing-(?:legal|econ|general)(?:/SKILL\.md)?)',  # legacy hardcoded domain path
    re.IGNORECASE,
)
AI_ANTI_PATTERN = re.compile(r'ai-anti-patterns')


def check(context):
    """Returns list of violations. Empty list = pass."""
    violations = []
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'

    if not skills_dir.exists():
        return violations

    for skill_name in PROSE_SKILLS:
        skill_file = skills_dir / skill_name / 'SKILL.md'
        if not skill_file.exists():
            continue

        text = skill_file.read_text()
        has_domain = bool(DOMAIN_SKILL_PATTERN.search(text))
        has_ai = bool(AI_ANTI_PATTERN.search(text))

        if not has_domain:
            violations.append(f"{skill_name}/SKILL.md has no domain-skill loading instruction (expected a 'load the domain skill' / style-selected / writing-legal|econ|general reference)")
        if not has_ai:
            violations.append(f"{skill_name}/SKILL.md does not reference ai-anti-patterns loading")

    return violations


if __name__ == "__main__":
    import json, sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
