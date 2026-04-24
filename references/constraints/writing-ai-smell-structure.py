#!/usr/bin/env -S uv run python3
"""Constraint: writing-ai-smell-structure — flag formulaic AI structural openers at paragraph start."""

import re
import sys
from pathlib import Path

CONSTRAINT = "writing-ai-smell-structure"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

# All patterns fire only at paragraph-start lines (the first prose line after a blank
# line, heading, blockquote, or document start). This minimises false positives from
# these phrases appearing legitimately mid-paragraph (e.g., "Moreover" in a parenthetical).
_PARA_START_PATTERNS = [
    # Meta-commentary openers — Volokh flags these as mechanical summarizing
    (re.compile(r'^In\s+(?:summary|conclusion|closing|sum)[,:\s]', re.I), 'structure:summary-opener'),
    (re.compile(r'^To\s+summarize\b', re.I), 'structure:to-summarize'),
    # "Despite X, Y" concessive formula — paragraph-opening Despite + noun phrase + comma
    # Common AI pattern: "Despite its success, [subject] faces challenges..."
    (re.compile(r'^Despite\s+\S[^,\n]{2,70},', re.I), 'structure:despite-formula'),
    # Filler transitions — Volokh prefers these be cut; especially dense in AI prose.
    # Law review prose uses them legitimately, hence soft-only.
    (re.compile(r'^Furthermore[,:]', re.I), 'structure:filler-furthermore'),
    (re.compile(r'^Moreover[,:]', re.I), 'structure:filler-moreover'),
    (re.compile(r'^In\s+addition[,:]', re.I), 'structure:filler-in-addition'),
    (re.compile(r'^Additionally[,:]', re.I), 'structure:filler-additionally'),
    (re.compile(r'^That\s+said[,:]', re.I), 'structure:filler-that-said'),
    (re.compile(r'^With\s+that\s+said[,:]', re.I), 'structure:filler-with-that-said'),
]

_FRONTMATTER_DELIM = re.compile(r'^---\s*$')
_FENCE = re.compile(r'^(?:```|~~~)')
_BLOCKQUOTE = re.compile(r'^\s*>')
_FOOTNOTE_DEF = re.compile(r'^\s*\[\^')
_HTML_COMMENT_OPEN = re.compile(r'<!--')
_HTML_COMMENT_CLOSE = re.compile(r'-->')
_HEADING = re.compile(r'^#+\s')


def _prose_lines_with_context(text):
    """Yield (1-indexed line number, stripped line, is_para_start) for prose-only content.

    is_para_start is True for the first prose line following a blank line, heading,
    blockquote, code fence, footnote definition, or document start.
    """
    lines = text.splitlines()
    in_frontmatter = False
    frontmatter_done = False
    in_fence = False
    in_html_comment = False
    at_para_start = True  # document start counts as paragraph start

    for i, line in enumerate(lines, 1):
        if not frontmatter_done and _FRONTMATTER_DELIM.match(line):
            in_frontmatter = not in_frontmatter
            if not in_frontmatter:
                frontmatter_done = True
            continue
        if in_frontmatter:
            continue
        frontmatter_done = True

        if _HTML_COMMENT_OPEN.search(line):
            in_html_comment = True
        if in_html_comment:
            if _HTML_COMMENT_CLOSE.search(line):
                in_html_comment = False
            continue

        stripped = line.strip()

        if _FENCE.match(stripped):
            in_fence = not in_fence
            at_para_start = True
            continue
        if in_fence:
            continue

        if _BLOCKQUOTE.match(line) or _FOOTNOTE_DEF.match(line):
            at_para_start = True
            continue

        if stripped == '' or _HEADING.match(stripped):
            at_para_start = True
            continue

        # Regular prose line
        yield i, stripped, at_para_start
        at_para_start = False


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8", errors="ignore")
        for lineno, stripped, is_para_start in _prose_lines_with_context(text):
            if not is_para_start:
                continue
            for pat, label in _PARA_START_PATTERNS:
                if pat.match(stripped):
                    snippet = stripped[:80]
                    violations.append(
                        f"drafts/{md_file.name}:{lineno}: [{label}] {snippet!r}"
                    )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
