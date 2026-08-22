#!/usr/bin/env -S uv run --with lxml,pyyaml python3
"""Constraint: writing-no-bold-lead — no bold inline-header paragraph starts in prose drafts.

ONE IMPLEMENTATION, NOT TWO. This module used to carry its own regex,
`^\\*\\*[A-Z][^*]+[.?:]\\*\\*\\s+\\S`, which was markdown-only, `drafts/*.md`-only, had no concept
of `#strong[]` or `\\textbf{}`, and no concept of a list item. `scripts/prose-audit.py` now owns
the rule as `emphasis·bold-lead`, format-agnostic and list-item-exempt, so this constraint DELEGATES
rather than reimplementing. Two implementations of one rule with different semantics is exactly the
failure docs/DESIGN-prose-constraint-architecture.md was written about, and the reason System C was
absorbed into System B in v5.127.0.

What this file still owns, and why it is not simply deleted: the `CONSTRAINT`/`APPLIES_TO`/
`SEVERITY` contract and the `drafts/<file>:<line>: …` violation shape that the deterministic
mechanical floor is defined in terms of. The hook gate that once consumed it was retired with the
beat spine (docs/DESIGN-prose-constraint-architecture.md); the contract outlived it because
check-all.py auto-discovers on it.

COST: one `prose-audit.py` subprocess per draft, inside check-all.py. That is the price of having
the rule live in exactly one place; a project with many drafts pays it linearly.
"""
import json
import subprocess
import sys
from pathlib import Path

CONSTRAINT = "writing-no-bold-lead"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise"]
SEVERITY = "hard"

PROSE_AUDIT = Path(__file__).resolve().parents[2] / "scripts" / "prose-audit.py"
_LABEL = "emphasis·bold-lead"


def _bold_leads(path: Path) -> list[tuple[int, str]]:
    """[(line, bold label text)] for one file, via the audit. Any failure yields nothing: a
    constraint that cannot run must not manufacture violations."""
    try:
        proc = subprocess.run(
            [sys.executable, str(PROSE_AUDIT), "--json", str(path)],
            capture_output=True, text=True, timeout=120, check=False)
        payload = json.loads(proc.stdout)
    except Exception:
        return []
    out = []
    for span in payload.get("spans", []):
        if any(lab.startswith(_LABEL) for lab in span.get("labels", [])):
            out.append((int(span.get("line") or 0), span.get("quote", "")))
    return out


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        for line, label_text in _bold_leads(md_file):
            violations.append(
                f"drafts/{md_file.name}:{line}: bold-lead pattern "
                f"'**{label_text}**' — use prose topic sentence or *italic* label"
            )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
