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

# parents[3] — this file is <repo>/skills/writing/references/, so three levels up is the repo root.
# Every sibling module in this directory counts the same way; `parents[2]` resolved to
# <repo>/skills/scripts/prose-audit.py and made the constraint inert from v6.0.0.
PROSE_AUDIT = Path(__file__).resolve().parents[3] / "scripts" / "prose-audit.py"
_LABEL = "emphasis·bold-lead"


def _bold_leads(path: Path) -> list[tuple[int, str]]:
    """[(line, bold label text)] for one file, via the audit.

    A FAILURE HERE RAISES. It must not manufacture violations — but it must not be silent either.
    `except Exception: return []` is what turned a broken engine path into `passed` for two minor
    versions: check() returned [], check-all.py filed a SEVERITY="hard" constraint under passed, and
    a reader auditing "is bold-lead enforced?" saw a clean pass. check-all.py:229-237 puts a raised
    exception under `errors`, which is neither `passed` nor a fabricated `failed`, and which makes
    its own exit non-zero. That is the only honest report of "the checker could not be reached".
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
