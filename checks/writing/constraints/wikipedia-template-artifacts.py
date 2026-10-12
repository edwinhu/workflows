#!/usr/bin/env -S uv run python3
"""Constraint: ai-template-artifacts — detect unfilled placeholder text in draft files."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # _writing: the contract, prose_extract
from _writing import main, prose, prose_extract
from _writing import rel as _rel

CONSTRAINT = "wikipedia-template-artifacts"
SEVERITY = "hard"  # Placeholders must never appear in final draft
AUDIT_SYSTEM = "wikipedia-template-artifacts"  # prose-audit.py's system for these tables (default: the directory's style guide)
AUDIT_ORDER = 5  # prose-audit.py's load order among declared systems: the first names a span tied tables match
AUDIT_IGNORE_CASE = False  # matched case-sensitively, exactly as check() does

_PLACEHOLDER_PATTERNS = [
    # Bracket placeholders: [Name], [Date], [Source URL], [describe X], [insert Y]
    #
    # `(?!\()` EXCLUDES MARKDOWN LINKS. `[Some Title](url)` matched this rule, and this module is
    # SEVERITY = "hard" — which, since check-all started reporting severity and the gates started
    # denying on it (v5.127.0), means an ordinary link in a draft could BLOCK a phase. Hard is the
    # class that is supposed to have no false positives; a link is not an unfilled placeholder.
    #
    # `(?<![\w)\]#])` EXCLUDES A MARKUP CALL'S ARGUMENT. Typst writes `#emph[Howey]`,
    # `#smallcaps[Securities Regulation]`, `#text(14pt)[LAW8016]` — the bracket holds content,
    # not a blank. Same class of false positive as the link, same cost: hard severity blocks a
    # phase. A placeholder never follows an identifier or a closing paren.
    (r'(?<![\w)\]#])\[[A-Z][a-zA-Z\s\']+\](?!\()',
     "placeholder: '[Name]'-style unfilled bracket"),
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


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = context["files"]  # the prose files handed in, wherever they lie

    if not draft_files:
        return violations

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        rel = _rel(path, cwd)
        for i, line in line_iter:
            for pattern, label in _PLACEHOLDER_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"{rel}:{i}: {label} — fill in or delete before finalizing")
    return violations


if __name__ == "__main__":
    raise SystemExit(main(CONSTRAINT, check, prose))
