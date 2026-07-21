#!/usr/bin/env -S uv run python3
"""
SubagentStart hook: brief every spawned subagent with the project's domain knowledge.

WHY THIS EXISTS
    Domain references (e.g. wrds/references/taq.md) are globbed ONCE by ds-plan Step 5b
    while drafting the plan. Nothing re-reads them during implementation, so a subagent
    spawned to write code starts with no idea that verified, project-specific facts exist
    -- and re-derives (or contradicts) them. Observed 2026-07-21: a TAQ pipeline was
    rebuilt from scratch when taq.md already documented the correct pattern WITH
    benchmarks, and a reference file's own validation numbers were treated as ground
    truth when they were provisional.

    SubagentStart is one of the events that DOES support
    hookSpecificOutput.additionalContext (unlike PreCompact), so it is the right place
    to re-assert this. See https://code.claude.com/docs/en/hooks.md

WHAT IT INJECTS
    - the active workflow + phase, from .planning/STATE.md
    - the domain skills listed in SPEC.md/PLAN.md, with their references/ paths
    - a hard instruction to READ them before writing code in that domain
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SKILLS_ROOT = Path.home() / 'projects' / 'workflows' / 'skills'


def read(p: Path) -> str:
    try:
        return p.read_text(encoding='utf-8')
    except (IOError, OSError):
        return ''


def domain_skills() -> list[str]:
    """Skill names listed in .planning/SPEC.md or PLAN.md (the 'Skills Touched' section)."""
    skills: list[str] = []
    for name in ('STATE.md', 'SPEC.md', 'PLAN.md'):
        text = read(Path.cwd() / '.planning' / name)
        for m in re.finditer(r'^\s*[-*]\s+`([a-z0-9][a-z0-9:_-]*)`\s*[-—]', text, re.M):
            s = m.group(1)
            if s not in skills:
                skills.append(s)
    return skills


def reference_files(skill: str) -> list[str]:
    d = SKILLS_ROOT / skill / 'references'
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.glob('*.md'))


def active_workflow() -> str | None:
    m = re.search(r'^## Active workflow:\s*/?(\S+)', read(Path.cwd() / '.planning' / 'STATE.md'), re.M)
    if m and m.group(1).upper() != 'UNKNOWN':
        return m.group(1).lstrip('/')
    return None


def main():
    try:
        json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        pass

    if not (Path.cwd() / '.planning').is_dir():
        sys.exit(0)

    parts: list[str] = []

    wf = active_workflow()
    if wf:
        parts.append(
            f"ACTIVE WORKFLOW: /{wf}. This task is part of that workflow -- follow its "
            f"conventions, and read .planning/STATE.md, SPEC.md and PLAN.md for the "
            f"current phase, constraints and decisions already made."
        )

    skills = domain_skills()
    if skills:
        lines = [
            "DOMAIN KNOWLEDGE -- READ BEFORE WRITING ANY CODE IN THESE AREAS.",
            "",
            "These reference files contain VERIFIED, project-specific facts (data-model",
            "gotchas, validated patterns, measured benchmarks) that SUPERSEDE your training",
            "data. They are frequently updated. Re-derived answers have repeatedly been wrong",
            "or slower than the documented pattern. Read the relevant file FIRST, and treat",
            "numbers in them as provisional if they are the project's own (not published)",
            "results.",
            "",
        ]
        for s in skills:
            refs = reference_files(s)
            base = SKILLS_ROOT / s / 'references'
            if refs:
                lines.append(f"- `{s}` -> {base}/")
                lines.append(f"    {', '.join(refs)}")
            else:
                lines.append(f"- `{s}` (skill: {SKILLS_ROOT / s})")
        parts.append("\n".join(lines))

    if not parts:
        sys.exit(0)

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SubagentStart",
            "additionalContext": "\n\n".join(parts),
        }
    }))
    sys.exit(0)


if __name__ == '__main__':
    main()
