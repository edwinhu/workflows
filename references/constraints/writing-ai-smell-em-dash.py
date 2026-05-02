#!/usr/bin/env -S uv run python3
"""Constraint: writing-ai-smell-em-dash — flag paragraphs with excessive em-dash density."""

import re
import sys
from pathlib import Path

CONSTRAINT = "writing-ai-smell-em-dash"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

# Per-paragraph threshold: flag paragraphs with ≥ this many em-dashes.
_DENSITY_THRESHOLD = 4

# Per-section threshold: flag sections (## heading or file preamble) that
# cumulatively carry more than this many em-dashes. LLMs spread em-dashes
# across adjacent paragraphs even when each paragraph is under the per-
# paragraph threshold, giving readers the impression that "every paragraph
# has one." Four per section keeps em-dashes rhetorical and rare.
_SECTION_THRESHOLD = 4

_EM_DASH = re.compile(r'—')
# Em-dash immediately adjacent to a colon is a formatting artifact, not standard punctuation.
_EM_DASH_COLON = re.compile(r'(?:—:|:—)')

_FRONTMATTER_DELIM = re.compile(r'^---\s*$')
_FENCE = re.compile(r'^(?:```|~~~)')
_BLOCKQUOTE = re.compile(r'^\s*>')
_FOOTNOTE_DEF = re.compile(r'^\s*\[\^')
_HTML_COMMENT_OPEN = re.compile(r'<!--')
_HTML_COMMENT_CLOSE = re.compile(r'-->')


def _prose_paragraphs(text):
    """Yield (start_line_1indexed, paragraph_text) for each prose paragraph.

    Paragraph boundaries: blank lines, headings, blockquotes, code fences.
    Skips YAML frontmatter, fenced code blocks, blockquotes, footnote definitions,
    and HTML comments.
    """
    lines = text.splitlines()
    in_frontmatter = False
    frontmatter_done = False
    in_fence = False
    in_html_comment = False

    paragraphs = []
    current_lines = []
    current_start = None

    def flush():
        if current_lines:
            paragraphs.append((current_start, '\n'.join(current_lines)))
            current_lines.clear()

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
            # Don't flush — just skip the line
            continue

        stripped = line.strip()

        if _FENCE.match(stripped):
            in_fence = not in_fence
            flush()
            continue
        if in_fence:
            continue

        # Blockquotes and footnote defs break the prose paragraph
        if _BLOCKQUOTE.match(line) or _FOOTNOTE_DEF.match(line):
            flush()
            continue

        # Blank line or heading: paragraph boundary
        if stripped == '' or stripped.startswith('#'):
            flush()
            continue

        # Regular prose line
        if not current_lines:
            current_start = i
        current_lines.append(line)

    flush()
    return paragraphs


_SECTION_HEADING = re.compile(r'^##\s+(.+?)\s*$', re.MULTILINE)


def _sections(text):
    """Split a markdown draft into (section_heading, section_body) pairs.
    The first chunk before any `## ` heading is labeled with the file's
    top-level `# ` heading if present, else "(preamble)".
    """
    # Find top-level heading for preamble label
    top_m = re.search(r'^#\s+(.+?)\s*$', text, re.MULTILINE)
    preamble_name = top_m.group(1).strip() if top_m else "(preamble)"
    # Split on ## headings; keep the heading with the section it introduces
    pieces = re.split(r'(^##\s+.+?$)', text, flags=re.MULTILINE)
    sections = []
    if pieces:
        # The first element is preamble (before any ##)
        sections.append((preamble_name, pieces[0]))
        for i in range(1, len(pieces), 2):
            heading = re.sub(r'^##\s+', '', pieces[i]).strip()
            body = pieces[i + 1] if i + 1 < len(pieces) else ""
            sections.append((heading, body))
    return sections


def check(context):
    """Returns list of violations. Empty list = pass.

    Two classes of flag:
      (1) Per-paragraph density: ≥ _DENSITY_THRESHOLD em-dashes in one paragraph.
      (2) Per-section density: > _SECTION_THRESHOLD em-dashes total across all
          prose paragraphs in a single ## section.
    """
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8", errors="ignore")

        # (1) Per-paragraph checks (existing behavior)
        for start_line, para in _prose_paragraphs(text):
            dash_count = len(_EM_DASH.findall(para))
            has_colon_combo = bool(_EM_DASH_COLON.search(para))

            if dash_count >= _DENSITY_THRESHOLD:
                snippet = para.replace('\n', ' ')[:80]
                violations.append(
                    f"drafts/{md_file.name}:{start_line}: [em-dash:density] "
                    f"{dash_count} em-dashes in paragraph — {snippet!r}"
                )
            elif has_colon_combo:
                snippet = para.replace('\n', ' ')[:80]
                violations.append(
                    f"drafts/{md_file.name}:{start_line}: [em-dash:colon-combo] "
                    f"em-dash adjacent to colon — {snippet!r}"
                )

        # (2) Per-section density
        for heading, body in _sections(text):
            # Count em-dashes in prose paragraphs of this section only
            section_count = sum(
                len(_EM_DASH.findall(para))
                for _, para in _prose_paragraphs(body)
            )
            if section_count > _SECTION_THRESHOLD:
                violations.append(
                    f"drafts/{md_file.name}: [em-dash:section-density] "
                    f"{section_count} em-dashes in section {heading!r} "
                    f"(budget: {_SECTION_THRESHOLD})"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
