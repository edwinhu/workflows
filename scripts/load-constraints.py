#!/usr/bin/env -S uv run python3
"""Load constraint .md prose for a skill, filtered by applies-to frontmatter.

Mirrors check-all.py's auto-discovery but for .md context injection.
Globs references/constraints/*.md, parses applies-to, outputs matching content.

Usage:
    uv run python3 scripts/load-constraints.py workshop
    uv run python3 scripts/load-constraints.py workshop-revise

Designed to be called from a SKILL.md bang line:
    !`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py skill-name`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BANG_MARKER = "/tmp/workflows-constraints-loaded.json"


def parse_frontmatter(text: str) -> tuple[dict[str, str | list[str]], str]:
    """Parse YAML-ish frontmatter. Returns (metadata dict, body)."""
    if not text.startswith("---"):
        return {}, text

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text

    meta: dict[str, str | list[str]] = {}
    for line in parts[1].strip().splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            items = [item.strip().strip("'\"") for item in val[1:-1].split(",")]
            meta[key.strip()] = [i for i in items if i]
        else:
            meta[key.strip()] = val

    return meta, parts[2]


def skill_matches(applies_to: list[str], skill_name: str) -> bool:
    """Check if a skill name matches the applies-to list.

    Matching is name-boundary aware, mirroring check-all.py's `_applies`:
      - "all"                        → matches everything
      - entry == skill               → exact match ("ds-plan" ⊃ ds-plan)
      - entry startswith skill + "-" → workflow entry point picks up its own
                                       phase constraints ("ds" ⊃ ds-implement)

    A bare substring test would be wrong: it made "ds" match "wrds", so the
    /ds entry point silently loaded wrds-sge-enforcement.
    """
    skill_lower = skill_name.lower()
    for entry in applies_to:
        entry_lower = entry.lower()
        if entry_lower == "all":
            return True
        if entry_lower == skill_lower:
            return True
        if entry_lower.startswith(skill_lower + "-"):
            return True
    return False


def load_constraints(skill_name: str, constraints_dir: str | None = None) -> str:
    """Load and concatenate all constraint .md files matching skill_name."""
    if constraints_dir is None:
        script_dir = Path(__file__).resolve().parent
        constraints_dir = str(script_dir.parent / "references" / "constraints")

    cdir = Path(constraints_dir)
    if not cdir.is_dir():
        print(f"Error: {constraints_dir} not found", file=sys.stderr)
        sys.exit(1)

    output_parts: list[str] = []
    matched = 0
    skipped = 0

    for md_path in sorted(cdir.glob("*.md")):
        text = md_path.read_text()
        meta, body = parse_frontmatter(text)

        applies_to = meta.get("applies-to", [])
        if isinstance(applies_to, str):
            applies_to = [applies_to]

        if not applies_to:
            applies_to = ["all"]

        if skill_matches(applies_to, skill_name):
            name = meta.get("name", md_path.stem)
            output_parts.append(f"# Constraint: {name}")
            output_parts.append(body.strip())
            output_parts.append("")
            matched += 1
        else:
            skipped += 1

    if not output_parts:
        print(f"# No constraints found for skill: {skill_name}", file=sys.stderr)
        return ""

    marker = {"skill": skill_name, "matched": matched, "skipped": skipped}
    Path(BANG_MARKER).write_text(json.dumps(marker))

    header = f"# Loaded {matched} constraints for {skill_name} ({skipped} skipped)\n"
    return header + "\n".join(output_parts)


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    skill_name = sys.argv[1]

    constraints_dir = None
    if len(sys.argv) >= 4 and sys.argv[2] == "--dir":
        constraints_dir = sys.argv[3]

    output = load_constraints(skill_name, constraints_dir)
    if output:
        print(output)


if __name__ == "__main__":
    main()
