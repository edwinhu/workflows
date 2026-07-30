#!/usr/bin/env -S uv run python3
"""Constraint: ds-external-skill-discovery.

If the immutable copied native PLAN.md references an external plugin skill, it
must record the discovery and ADOPT/PATCH/GREENFIELD decision. Runs against
`.planning/PLAN.md` in the caller's cwd.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CONSTRAINT = "ds-external-skill-discovery"
APPLIES_TO = ["ds", "ds-fix"]
SEVERITY = "hard"

# External skills that have examples/ or references/ directories worth checking.
# Extend as new sibling skills acquire examples.
EXTERNAL_SKILLS = [
    "wrds",
    "gemini-batch",
    "lseg-data",
    "nlm",
    "readwise",
    "bluebook",
    "docx",
    "pptx",
    "xlsx",
    "pdf",
]

SKILL_REF_PATTERNS = [
    re.compile(rf"skills/{name}/", re.IGNORECASE) for name in EXTERNAL_SKILLS
]
BARE_NAME_PATTERNS = [
    re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE) for name in EXTERNAL_SKILLS
]

DISCOVERY_HEADER = re.compile(
    r"^##\s+External Skill Discovery\b", re.IGNORECASE | re.MULTILINE
)


def _referenced_skills(text: str) -> list[str]:
    hits = []
    for name, path_re, bare_re in zip(EXTERNAL_SKILLS, SKILL_REF_PATTERNS, BARE_NAME_PATTERNS):
        if path_re.search(text) or bare_re.search(text):
            hits.append(name)
    return hits


def check(context: dict) -> list[str]:
    cwd = Path(context.get("cwd", "."))
    plan = cwd / ".planning" / "PLAN.md"
    if not plan.exists():
        return []  # No plan yet = nothing to check

    text = plan.read_text(encoding="utf-8", errors="replace")
    referenced = _referenced_skills(text)
    if not referenced:
        return []

    violations = []
    if not DISCOVERY_HEADER.search(text):
        skills = ", ".join(sorted(set(referenced)))
        violations.append(
            f"Approved native PLAN.md references external skills ({skills}) but has no "
            f'"## External Skill Discovery" section. Return to native Plan mode, enumerate each '
            f"skill's references/ and examples/, load domain-specific refs, read matching example "
            f"READMEs, and record ADOPT/PATCH/GREENFIELD decisions before replacement approval."
        )
    else:
        # Weak check: the section must mention Glob or examples/ or a decision
        # verb, otherwise it's just a header with no content.
        section_body = text[DISCOVERY_HEADER.search(text).end():]  # type: ignore[union-attr]
        next_header = re.search(r"^## ", section_body, re.MULTILINE)
        if next_header:
            section_body = section_body[: next_header.start()]
        required_tokens = ["examples/", "Glob", "ADOPT", "PATCH", "GREENFIELD"]
        if not any(tok.lower() in section_body.lower() for tok in required_tokens):
            violations.append(
                'Approved native PLAN.md "External Skill Discovery" section is a stub — it '
                "must document enumeration results, loaded references, example READMEs "
                "read, and an ADOPT/PATCH/GREENFIELD decision per planned task."
            )
    return violations


if __name__ == "__main__":
    cwd = sys.argv[1] if len(sys.argv) > 1 else "."
    vs = check({"cwd": cwd})
    if vs:
        for v in vs:
            print(f"FAIL [{CONSTRAINT}]: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
