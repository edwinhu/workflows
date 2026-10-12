#!/usr/bin/env -S uv run --with lxml,pyyaml python3
"""Constraint: writing-no-bold-lead — no bold inline-header paragraph starts in prose drafts.

ONE IMPLEMENTATION, NOT TWO. This module used to carry its own regex,
`^\\*\\*[A-Z][^*]+[.?:]\\*\\*\\s+\\S`, which was markdown-only, `drafts/*.md`-only, had no concept
of `#strong[]` or `\\textbf{}`, and no concept of a list item. `scripts/prose-audit.py` now owns
the rule as `emphasis·bold-lead`, format-agnostic and list-item-exempt, so this constraint DELEGATES
rather than reimplementing. Two implementations of one rule with different semantics is exactly the
failure docs/DESIGN-prose-constraint-architecture.md was written about, and the reason System C was
absorbed into System B in v5.127.0.

What this file still owns, and why it is not simply deleted: a place in checks/writing/constraints/,
which is what makes bin/workflow-check run the rule, and the `<file>:<line>: …` finding shape of the
constraint contract (_writing.py).

COST: one `prose-audit.py` subprocess per .md file handed in. That is the price of having the rule
live in exactly one place; a run over many drafts pays it linearly.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _writing import PLUGIN, main, markdown, rel

CONSTRAINT = "writing-no-bold-lead"
SEVERITY = "hard"

PROSE_AUDIT = PLUGIN / "scripts" / "prose-audit.py"
_LABEL = "emphasis·bold-lead"


def _bold_leads(path: Path) -> list[tuple[int, str]]:
    """[(line, bold label text)] for one file, via the audit.

    A FAILURE HERE RAISES. It must not manufacture violations — but it must not be silent either.
    `except Exception: return []` is what turned a broken engine path into `passed` for two minor
    versions. _writing.main reports a raised exception as COULD-NOT-RUN (exit 2), which is neither a
    pass nor a fabricated finding: the only honest report of "the checker could not be reached".
    """
    if not PROSE_AUDIT.is_file():
        raise FileNotFoundError(
            f"{CONSTRAINT}: prose-audit.py not found at {PROSE_AUDIT} — this constraint delegates "
            f"to it entirely and cannot be evaluated without it")
    proc = subprocess.run(
        [sys.executable, str(PROSE_AUDIT), "--json", str(path)],
        capture_output=True, text=True, timeout=120, check=False)
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"{CONSTRAINT}: prose-audit.py returned unparseable output for {path} "
            f"(exit {proc.returncode}): {(proc.stderr or proc.stdout)[:400]}") from exc
    out = []
    for span in payload.get("spans", []):
        if any(lab.startswith(_LABEL) for lab in span.get("labels", [])):
            out.append((int(span.get("line") or 0), span.get("quote", "")))
    return out


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    for md_file in context["files"]:  # the .md files handed in, wherever they lie
        for line, label_text in _bold_leads(md_file):
            violations.append(
                f"{rel(md_file, cwd)}:{line}: bold-lead pattern "
                f"'**{label_text}**' — use prose topic sentence or *italic* label"
            )

    return violations


if __name__ == "__main__":
    raise SystemExit(main(CONSTRAINT, check, markdown, kind=".md file"))
