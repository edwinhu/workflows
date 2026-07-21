#!/usr/bin/env -S uv run python3
"""
PreCompact hook: Save state before context compaction.

1. Adds a compaction marker to LEARNINGS.md
2. Detects active workflow from PLAN.md
3. Outputs additionalContext with skill reload instructions

This helps Claude remember to reload workflow skills after compaction.
See: https://github.com/anthropics/claude-code/issues/13919
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

# Workflow patterns to detect in PLAN.md
WORKFLOW_PATTERNS = {
    'dev': [r'## Dev Workflow', r'/dev\b', r'TDD', r'RED-GREEN-REFACTOR'],
    'ds': [r'## DS Workflow', r'/ds\b', r'data science', r'EDA'],
    'writing': [r'## Writing', r'/writing\b', r'draft', r'revision'],
}


def find_learnings_file() -> Path | None:
    """Find LEARNINGS.md in .planning/ (new) or .claude/ (legacy)."""
    planning_path = Path.cwd() / '.planning' / 'LEARNINGS.md'
    if planning_path.exists():
        return planning_path
    legacy_path = Path.cwd() / '.claude' / 'LEARNINGS.md'
    return legacy_path if legacy_path.exists() else None


def find_plan_file() -> Path | None:
    """Find PLAN.md in .planning/ (new) or .claude/ (legacy)."""
    planning_path = Path.cwd() / '.planning' / 'PLAN.md'
    if planning_path.exists():
        return planning_path
    legacy_path = Path.cwd() / '.claude' / 'PLAN.md'
    return legacy_path if legacy_path.exists() else None


def find_state_file() -> Path | None:
    """Find STATE.md in .planning/."""
    state_path = Path.cwd() / '.planning' / 'STATE.md'
    return state_path if state_path.exists() else None


def detect_active_workflow(plan_path: Path) -> str | None:
    """Detect which workflow is active from PLAN.md content."""
    try:
        content = plan_path.read_text(encoding='utf-8')
        for workflow, patterns in WORKFLOW_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, content, re.IGNORECASE):
                    return workflow
        return None
    except (IOError, OSError):
        return None


def append_compaction_marker(learnings_path: Path, workflow: str | None) -> bool:
    """Append compaction marker to LEARNINGS.md."""
    timestamp = datetime.now().strftime('%H:%M')
    workflow_note = f" (workflow: /{workflow})" if workflow else ""
    marker = f"\n[Compaction at {timestamp}]{workflow_note} - Context was summarized\n"

    try:
        with open(learnings_path, 'a', encoding='utf-8') as f:
            f.write(marker)
        return True
    except (IOError, OSError) as e:
        print(f"[PreCompact] Failed to update LEARNINGS.md: {e}", file=sys.stderr)
        return False


def domain_skills_from_spec() -> list[str]:
    """Skills listed under a 'Skills Touched'-style section of SPEC.md / PLAN.md.

    ds-plan Step 5b globs these skills' references/ ONCE while drafting the plan. That is
    plan-time only -- nothing re-reads them during implementation, which is how stale
    domain knowledge slips through. Persisting them here lets SubagentStart re-assert it.
    """
    skills: list[str] = []
    for name in ('SPEC.md', 'PLAN.md'):
        p = Path.cwd() / '.planning' / name
        if not p.exists():
            continue
        try:
            text = p.read_text(encoding='utf-8')
        except (IOError, OSError):
            continue
        # lines like:  - `wrds` -- TAQ millisecond data, SAS on the WRDS grid
        for m in re.finditer(r'^\s*[-*]\s+`([a-z0-9][a-z0-9:_-]*)`\s*[-—]', text, re.M):
            s = m.group(1)
            if s not in skills:
                skills.append(s)
    return skills


def write_state_file(workflow: str | None, instructions: list[str]) -> None:
    """Persist workflow state so it survives compaction AND reaches spawned subagents."""
    planning = Path.cwd() / '.planning'
    if not planning.is_dir():
        return
    skills = domain_skills_from_spec()
    ts = datetime.now().strftime('%Y-%m-%d %H:%M')
    lines = [
        "# STATE (auto-written by pre-compact.py -- safe to edit by hand)",
        "",
        f"_Last updated: {ts}_",
        "",
        f"## Active workflow: {'/' + workflow if workflow else 'UNKNOWN'}",
        "",
        *(f"- {i}" for i in instructions),
        "",
    ]
    if skills:
        lines += [
            "## Domain knowledge — READ BEFORE WRITING CODE",
            "",
            "These skills' `references/` and `examples/` hold verified, project-specific",
            "facts that supersede training data. Re-read them at implementation time, not",
            "just at plan time:",
            "",
            *(f"- `{s}` — see `~/projects/workflows/skills/{s}/references/`" for s in skills),
            "",
        ]
    try:
        (planning / 'STATE.md').write_text("\n".join(lines), encoding='utf-8')
    except (IOError, OSError) as e:
        print(f"[PreCompact] Failed to write STATE.md: {e}", file=sys.stderr)


def main():
    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, KeyError):
        hook_input = {}

    # Detect active workflow from PLAN.md
    plan_path = find_plan_file()
    active_workflow = detect_active_workflow(plan_path) if plan_path else None

    # Update LEARNINGS.md with compaction marker
    learnings_path = find_learnings_file()
    if learnings_path:
        append_compaction_marker(learnings_path, active_workflow)

    # Build reload instructions for additionalContext
    reload_instructions = []

    if active_workflow:
        reload_instructions.append(
            f"IMPORTANT: The /{active_workflow} workflow was active before compaction. "
            f"After compaction completes, invoke /{active_workflow} to reload the workflow context."
        )
    else:
        reload_instructions.append(
            "After compaction, check .claude/PLAN.md to determine which workflow "
            "was in use (/dev, /ds, or /writing) and reload it."
        )

    # Include .planning/STATE.md if it exists
    state_path = find_state_file()
    if state_path:
        reload_instructions.append(
            "Read .planning/STATE.md for current workflow phase and decisions."
        )

    # Always remind about LEARNINGS.md
    if learnings_path:
        learnings_loc = str(learnings_path.relative_to(Path.cwd()))
        reload_instructions.append(
            f"Read {learnings_loc} for session context and recent progress."
        )

    # PreCompact does NOT support hookSpecificOutput.additionalContext -- the harness
    # rejects the whole payload ("Hook JSON output validation failed"), silently dropping
    # the reload instruction. Per https://code.claude.com/docs/en/hooks.md PreCompact only
    # accepts top-level `decision`/`reason` plus universal fields (systemMessage, continue,
    # suppressOutput, stopReason, terminalSequence).
    #
    # So PERSIST the state to .planning/STATE.md instead. SessionStart surfaces .planning/
    # on the next session, and subagent-start.py reads STATE.md to brief spawned agents.
    if reload_instructions:
        write_state_file(active_workflow, reload_instructions)
        print(json.dumps({
            "systemMessage": f"Workflow state saved to .planning/STATE.md"
                             + (f" (/{active_workflow} active)" if active_workflow else "")
        }))

    sys.exit(0)


if __name__ == '__main__':
    main()
