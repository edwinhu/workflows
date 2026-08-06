#!/usr/bin/env -S uv run python3
"""Constraint: topic-change-protocol — verify workflow phase skills AUTO-LOAD this constraint.

Authoring lint (checks the plugin's own skills/, not a user's document). Verifies the REAL
loading mechanism: (a) topic-change-protocol.md's `applies-to` includes the phase skill AND
(b) the skill invokes `load-constraints.ts` (the auto-loader). The earlier version checked for a
literal `.md` string reference in SKILL.md — a mechanism the auto-loader superseded — so it
false-failed once check-all correctly scoped it to writing projects.
"""

CONSTRAINT = "topic-change-protocol"
APPLIES_TO = ["writing-setup", "writing-outline", "writing-draft",
              "writing-validate", "writing-verify", "writing-revise"]
SEVERITY = "hard"

import re
from pathlib import Path

# All workflow phase skills (except the entry router, which loads only the index) must auto-load this
PHASE_SKILLS = ['writing-setup', 'writing-outline', 'writing-draft',
                'writing-validate', 'writing-verify', 'writing-revise']


def _md_applies_to(md_path):
    """Parse the `applies-to` list from a constraint .md's frontmatter (list or scalar form)."""
    if not md_path.exists():
        return []
    text = md_path.read_text()
    m = re.search(r'^applies-to:\s*\[(.*?)\]', text, re.M)
    if m:
        return [s.strip().strip('"\'').lower() for s in m.group(1).split(',') if s.strip()]
    m = re.search(r'^applies-to:\s*(\S.*)$', text, re.M)
    return [m.group(1).strip().lower()] if m else []


def check(context):
    """Returns list of violations. Empty list = pass. Verifies the auto-load wiring."""
    violations = []
    plugin_dir = Path(__file__).resolve().parent.parent.parent
    skills_dir = plugin_dir / 'skills'
    if not skills_dir.exists():
        return violations

    applies = _md_applies_to(plugin_dir / 'references' / 'constraints' / f'{CONSTRAINT}.md')
    for skill_name in PHASE_SKILLS:
        skill_file = skills_dir / skill_name / 'SKILL.md'
        if not skill_file.exists():
            continue
        if skill_name.lower() not in applies:
            violations.append(
                f"{CONSTRAINT}.md `applies-to` omits {skill_name} — it will NOT auto-load there.")
        elif 'load-constraints.ts' not in skill_file.read_text():
            violations.append(
                f"{skill_name}/SKILL.md does not invoke load-constraints.ts — {CONSTRAINT} "
                "won't auto-load (workflow phases must run the constraint auto-loader).")
    return violations


if __name__ == "__main__":
    import sys
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
