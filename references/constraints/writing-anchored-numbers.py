#!/usr/bin/env -S uv run python3
"""Constraint: writing-anchored-numbers — flag subsections with empirical numbers but no Table/Figure anchor.

Anchoring is per-subsection, not per-paragraph: if any paragraph in a subsection
carries a Table/Figure reference, all paragraphs in that subsection inherit it.
The Part-level lede (text between `#` and the first `##`) is exempt.
"""
import re
import sys
from pathlib import Path

CONSTRAINT = "writing-anchored-numbers"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise"]
SEVERITY = "hard"

_EMPIRICAL_NUMBER = re.compile(
    r'(?<!\[\^)'            # not a footnote marker
    r'(?:'
    r'\d+[.,]\d+%'          # 89.3%, 4,200.5%
    r'|\$[\d,.]+\s*[bmtBMT]?(?:illion|rillion)?'  # $4.2 trillion, $300
    r'|\d{2,}%'             # 89%, 12%
    r'|\d{1,3}(?:,\d{3})+'  # 42,000 or 2,123
    r'|\d+\.\d+'            # 0.034, 4.2 (decimals)
    r')'
)

_YEAR = re.compile(r'\b(19|20)\d{2}\b')
_SECTION_REF = re.compile(
    r'(?:Section|Part|Rule|Chapter|Article|Regulation|Schedule)\s+\d',
    re.I,
)
_FOOTNOTE_LINE = re.compile(r'^\s*\[\^')
_FRONTMATTER_DELIM = re.compile(r'^---\s*$')
_HEADING = re.compile(r'^(#+)\s+(.+)$')

_ANCHOR = re.compile(
    r'(?:Table|Figure|Fig\.|Panel|Appendix|Column|Exhibit)\s+[\dA-Z]'
    r'|@(?:tbl|fig|eq|sec):[A-Za-z0-9_:-]+'  # pandoc-crossref refs
    r'|\{#(?:tbl|fig|eq|sec):[A-Za-z0-9_:-]+\}',  # pandoc-crossref anchor defs
    re.I,
)


def _strip_footnote_lines(text):
    """Remove lines that are footnote definitions."""
    return "\n".join(
        line for line in text.splitlines() if not _FOOTNOTE_LINE.match(line)
    )


def _has_empirical_number(text):
    """True if the text contains a real empirical number (not just years/refs)."""
    cleaned = _SECTION_REF.sub('', text)
    cleaned = _YEAR.sub('', cleaned)
    return bool(_EMPIRICAL_NUMBER.search(cleaned))


def _split_subsections(lines):
    """Yield (start_line_1indexed, heading_level, heading_text, body_text) for each subsection.

    A Part-level lede (body after `#` heading before first `##`) is yielded with
    heading_level=1 so the caller can treat it as exempt.
    """
    in_frontmatter = False
    current_level = None
    current_heading = None
    current_start = None
    current_body = []
    # Track whether we're past the first `##` heading (i.e., past the Part-level lede)
    for i, line in enumerate(lines):
        if _FRONTMATTER_DELIM.match(line):
            in_frontmatter = not in_frontmatter
            continue
        if in_frontmatter:
            continue

        m = _HEADING.match(line.strip())
        if m:
            # Close out previous subsection
            if current_heading is not None:
                yield (current_start, current_level, current_heading, "\n".join(current_body))
            level = len(m.group(1))
            current_level = level
            current_heading = m.group(2)
            current_start = i + 1
            current_body = []
            continue

        if current_heading is None:
            # Text before any heading — skip (document-level frontmatter is handled separately)
            continue

        current_body.append(line)

    if current_heading is not None:
        yield (current_start, current_level, current_heading, "\n".join(current_body))


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        lines = md_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        for start_line, level, heading, body in _split_subsections(lines):
            # Exempt Part-level lede: body under `#` heading, before any `##` subsection
            # We detect this by level==1 (Part heading).
            if level == 1:
                continue
            # Exempt Abstract sections: they summarize findings anchored elsewhere
            if heading.strip().lower() == "abstract":
                continue
            body_no_footnotes = _strip_footnote_lines(body)
            if not _has_empirical_number(body_no_footnotes):
                continue
            if _ANCHOR.search(body_no_footnotes):
                continue
            # Find first empirical number for reporting
            first_match = _EMPIRICAL_NUMBER.search(body_no_footnotes)
            number_str = first_match.group() if first_match else "<number>"
            violations.append(
                f"drafts/{md_file.name}:{start_line}: un-anchored subsection "
                f"'{heading}' (first number: '{number_str}'). "
                f"Add a Table/Figure/Panel reference somewhere in the subsection body."
            )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
