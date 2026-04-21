#!/usr/bin/env -S uv run python3
"""Constraint check: phase skills must use the auto-loader bang, not manual Read() lists.

A phase skill that references `references/constraints/*.md` via multiple Read() lines
instead of the bang-invoked `load-constraints.py` is drifting from the architecture
workflow-creator recommends. Adding a new constraint then requires editing every
skill that should load it, defeating the `applies-to` auto-discovery model.

This check scans:
    skills/*/SKILL.md

For each SKILL.md:
    - If it bang-invokes `load-constraints.py` → compliant (PASS)
    - If it has 2+ separate Read() references to `references/constraints/*.md` and
      does NOT bang-invoke the loader → violation
    - If it has 0 or 1 Read() references → ad-hoc reference, not a phase set (PASS)

The 2+ threshold avoids flagging skills that Read a single constraint file as
documentation; phase constraint sets are always multiple files.
"""
from __future__ import annotations

import re
from pathlib import Path


LOADER_BANG_PATTERN = re.compile(
    r"!\s*`?uv run python3\s+\$\{CLAUDE_SKILL_DIR\}/\.\./\.\./scripts/load-constraints\.py\s+[\w-]+"
)
CONSTRAINT_REF_PATTERN = re.compile(
    r"\$\{CLAUDE_SKILL_DIR\}/\.\./\.\./references/constraints/[\w-]+\.md"
)


def check(context: dict) -> list[dict]:
    """Run the auto-loader-usage check. Returns list of violations."""
    cwd = Path(context.get("cwd", ".")).resolve()

    # Find repo root (look for .claude-plugin/)
    repo_root = cwd
    for _ in range(10):
        if (repo_root / ".claude-plugin").is_dir():
            break
        parent = repo_root.parent
        if parent == repo_root:
            return []
        repo_root = parent
    else:
        return []

    skills_dir = repo_root / "skills"
    if not skills_dir.is_dir():
        return []

    # Confirm the loader script exists — if not, manual Read is the only option
    loader_script = repo_root / "scripts" / "load-constraints.py"
    if not loader_script.is_file():
        return []

    violations = []
    for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
        text = skill_md.read_text()

        if LOADER_BANG_PATTERN.search(text):
            continue

        # Strip fenced code blocks (```...```) — references inside subagent
        # prompt templates are instructions passed to spawned agents, not
        # constraint loads by this skill itself.
        stripped = re.sub(r"```.*?```", "", text, flags=re.DOTALL)

        ref_hits = CONSTRAINT_REF_PATTERN.findall(stripped)
        if len(ref_hits) < 2:
            continue

        violations.append({
            "file": str(skill_md.relative_to(repo_root)),
            "check": "AUTO-LOADER-USAGE",
            "severity": "warning",
            "found": f"{len(ref_hits)} manual references to constraint files, no loader bang",
            "expected": (
                "!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py "
                f"{skill_md.parent.name}`"
            ),
            "context": (
                "Replace the manual Read() list with the bang-invoked loader. "
                "See references/constraints/auto-loader-usage.md."
            ),
        })

    return violations


if __name__ == "__main__":
    import json
    import sys

    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    results = check({"cwd": cwd})
    if results:
        print(json.dumps(results, indent=2))
        sys.exit(1)
    else:
        print("All phase skills use the auto-loader bang (or have <2 constraint reads).")
        sys.exit(0)
