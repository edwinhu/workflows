#!/usr/bin/env -S uv run python3
"""Constraint: ai-template-artifacts — detect unfilled placeholder text in draft files."""
import re
import sys
from pathlib import Path

# ── Shared draft extractor ─────────────────────────────────────────────
# Path traversal: <workflows>/skills/<skill>/references/<this file>
# We want         <workflows>/scripts/prose_extract.py
_SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
if (_SCRIPTS_DIR / "prose_extract.py").exists():
    sys.path.insert(0, str(_SCRIPTS_DIR))
import prose_extract  # noqa: E402

CONSTRAINT = "wikipedia-template-artifacts"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise", "writing-validate"]
SEVERITY = "hard"  # Placeholders must never appear in final draft

_PLACEHOLDER_PATTERNS = [
    # Bracket placeholders: [Name], [Date], [Source URL], [describe X], [insert Y]
    (r'\[[A-Z][a-zA-Z\s\']+\]', "placeholder: '[Name]'-style unfilled bracket"),
    (r'\[(describe|insert|add|enter|specify|include|provide|replace|your\s+\w+)[^\]]+\]',
     "placeholder: instructional bracket placeholder"),
    # Placeholder dates
    (r'\d{4}-xx-xx|\d{4}-\d{2}-xx', "placeholder: unfilled date 'YYYY-xx-xx'"),
    # FIXME/TODO/TBD in draft text
    (r'\b(FIXME|TODO|TBD|PLACEHOLDER|INSERT\s+HERE|ADD\s+CITATION|ADD\s+SOURCE)\b',
     "placeholder: in-text TODO/FIXME marker"),
    # [citation needed] style
    (r'\[(citation\s+needed|source\s+needed|verify|fact-check)\]',
     "placeholder: '[citation needed]' unfilled"),
]


def _find_draft_files(cwd):
    # Shared discovery — picks up .md, .markdown, .docx, .txt under
    # drafts/ and outlines/. See workflows/scripts/prose_extract.py.
    return prose_extract.find_draft_files(cwd)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = _find_draft_files(cwd)

    if not draft_files:
        return violations

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        rel = path.relative_to(cwd)
        for i, line in line_iter:
            for pattern, label in _PLACEHOLDER_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"{rel}:{i}: {label} — fill in or delete before finalizing")
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
