#!/usr/bin/env -S uv run python3
"""Constraint: writing-shortjournal — every @article bib entry should have a
non-blank `shortjournal` field so Bluebook-style CSLs resolve `form="short"`
to an abbreviated journal name rather than falling back to the full title.

Exempt: journals that are working papers, preprints, or non-journal venues
(SSRN, arXiv, Research Paper series, book chapters). Those don't get
Bluebook abbreviations.
"""
import re
import sys
from pathlib import Path

CONSTRAINT = "writing-shortjournal"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise"]
SEVERITY = "soft"

_ENTRY = re.compile(r'@article\s*\{\s*([^,\s]+)\s*,(.*?)(?=\n@|\Z)', re.DOTALL | re.IGNORECASE)
_FIELD = re.compile(r'^\s*([a-zA-Z]+)\s*=\s*\{([^}]*)\}', re.MULTILINE)

# Journals whose name implies they are not abbreviated in Bluebook T.13.
_EXEMPT_PATTERNS = [
    re.compile(r'SSRN', re.IGNORECASE),
    re.compile(r'arXiv', re.IGNORECASE),
    re.compile(r'Working Paper', re.IGNORECASE),
    re.compile(r'Research Paper', re.IGNORECASE),
    re.compile(r'Social Science Research Network', re.IGNORECASE),
    re.compile(r'Cambridge University Press', re.IGNORECASE),  # book chapters
    re.compile(r'Oxford University Press', re.IGNORECASE),
    re.compile(r'\(forthcoming\)', re.IGNORECASE),  # bare forthcoming w/o venue
]


def _exempt(journal_value: str) -> bool:
    return any(p.search(journal_value) for p in _EXEMPT_PATTERNS)


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    bib_path = cwd / "references" / "sources.bib"
    if not bib_path.is_file():
        return violations

    text = bib_path.read_text(encoding="utf-8", errors="ignore")

    # Precompute a line-number lookup for entries so we can cite the entry
    # opening line in violation messages.
    line_offsets = [0]
    for i, ch in enumerate(text):
        if ch == '\n':
            line_offsets.append(i + 1)

    def line_of(pos: int) -> int:
        import bisect
        return bisect.bisect_right(line_offsets, pos)

    for m in _ENTRY.finditer(text):
        bibkey = m.group(1)
        body = m.group(2)
        fields = {f.group(1).lower(): f.group(2).strip() for f in _FIELD.finditer(body)}
        journal = fields.get("journal", "").strip()
        shortjournal = fields.get("shortjournal", "").strip()

        if not journal:
            continue
        if _exempt(journal):
            continue

        entry_line = line_of(m.start())

        if "shortjournal" not in fields:
            violations.append(
                f"references/sources.bib:{entry_line}: @article{{{bibkey}}} "
                f"missing `shortjournal` for journal={{{journal}}} — "
                f"Bluebook CSL will fall back to full journal name"
            )
        elif not shortjournal:
            violations.append(
                f"references/sources.bib:{entry_line}: @article{{{bibkey}}} "
                f"has blank `shortjournal` for journal={{{journal}}} — "
                f"fill in Bluebook T.13 abbreviation or remove the field"
            )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"WARN: {v}")
        # Soft severity — exit 0 so check-all.py treats as advisory
        sys.exit(0)
    print(f"PASS: {CONSTRAINT}")
