#!/usr/bin/env -S uv run python3
"""Constraint: writing-outline-sync — a draft's `##`/`###` subsections should be planned in its outline.

Sections come from the plan's `## Section Outputs`, read through writing_section_index.py (the one grammar
parser): each section pairs `outlines/<Section>.md` with `drafts/<Section> (Draft).md`. A draft heading is planned
when its letter prefix (`A.`) is a bold bullet or `####` header in the outline, or when every significant word of
its title appears in the outline body. Drafts lead: a finding says the outline lacks the subsection, not that the
draft is wrong. Findings are file-level (line 1).

In scope when a file handed in is a planned section's outline or draft.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _writing import PLUGIN, emit, expand, guarded, parse

CONSTRAINT = "writing-outline-sync"
SEVERITY = "soft"

_INDEX = PLUGIN / "skills" / "writing" / "scripts" / "writing_section_index.py"
_FENCE = re.compile(r"^---\s*$", re.MULTILINE)
_BOLD_LETTER_BULLET = re.compile(r"^\s*[-*]\s+\*\*([A-Z])[\.\d]", re.MULTILINE)
_H4_LETTER_HEADER = re.compile(r"^####\s+([A-Z])\.", re.MULTILINE)
_SUBHEAD = re.compile(r"^(#{2,3})\s+(.+?)\s*$", re.MULTILINE)
_LETTERED = re.compile(r"^([A-Z])\.\s")
_STOP_WORDS = frozenset({"the", "a", "an", "of", "in", "and", "or", "for", "to", "by"})


def _body(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="ignore")
    if text.lstrip().startswith("---"):
        m = _FENCE.search(text, 3)
        if m:
            return text[m.end():]
    return text


def _covered(title: str, outline_body: str) -> bool:
    """Every significant (4+ char) word of `title` appears whole in the outline body; hyphens read as spaces."""
    words = [w for w in re.sub(r"[^\w\s]", " ", title.lower()).split() if w not in _STOP_WORDS and len(w) >= 4]
    return all(re.search(r"\b" + re.escape(w) + r"\b", outline_body) for w in words)


def sections(root: Path) -> list[dict]:
    """The plan's sections whose outline and draft both exist on disk; none when the project has no plan."""
    r = subprocess.run([sys.executable, str(_INDEX), str(root)], capture_output=True, text=True, timeout=60)
    try:
        index = json.loads(r.stdout)
    except ValueError:
        return []
    return [s for s in index.get("sections", []) if Path(s.get("outlineFile", "")).is_file() and Path(s.get("draftFile", "")).is_file()]


def check_section(section: dict, root: Path) -> list[str]:
    outline_path, draft_path = Path(section["outlineFile"]), Path(section["draftFile"])
    outline = _body(outline_path)
    letters = set(_BOLD_LETTER_BULLET.findall(outline)) | set(_H4_LETTER_HEADER.findall(outline))
    lowered = outline.lower().replace("-", " ")
    out = []
    for level, heading in _SUBHEAD.findall(_body(draft_path)):
        m = _LETTERED.match(heading)
        if (m and m.group(1) in letters) or _covered(heading.lower().replace("-", " "), lowered):
            continue
        out.append(
            f"{draft_path.relative_to(root) if draft_path.is_relative_to(root) else draft_path}:1: "
            f"{level} {heading} is not planned in {outline_path.relative_to(root) if outline_path.is_relative_to(root) else outline_path} "
            f"— add it to the outline or fold it into a planned subsection"
        )
    return out


def check(context: dict) -> list[str]:
    root = Path(context.get("cwd", ".")).resolve()
    return [f for s in sections(root) for f in check_section(s, root)]


def _cli() -> int:
    a = parse()
    root = Path(a.project_dir).resolve()
    try:
        given = {p.resolve() for p in expand(a.files)}
    except FileNotFoundError as e:
        print(f"COULD-NOT-RUN: {CONSTRAINT}: no file named {e}", file=sys.stderr)
        return 2
    scope = [s for s in sections(root) if {Path(s["outlineFile"]).resolve(), Path(s["draftFile"]).resolve()} & given]
    if not scope:
        why = f"none of the {len(given)} file(s) given is a planned section's outline or draft"
        return emit(CONSTRAINT, 0, "section(s)", why, [], root)
    return emit(CONSTRAINT, len(scope), "section(s)", "", [f for s in scope for f in check_section(s, root)], root)


if __name__ == "__main__":
    raise SystemExit(guarded(CONSTRAINT, _cli))
