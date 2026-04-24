#!/usr/bin/env -S uv run python3
"""Constraint: writing-ai-smell-artifacts — flag ChatGPT citation artifacts, prompt refusals, and unfilled template placeholders."""

import re
import sys
from pathlib import Path

CONSTRAINT = "writing-ai-smell-artifacts"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "hard"

# ChatGPT citation artifacts — copy-paste residue from ChatGPT web UI
# These are unambiguous: they cannot appear in legitimate human prose.
_CHATGPT_ARTIFACTS = [
    # turn0search0, citeturn1search2, iturn0image0, citeturn0news3, etc.
    (re.compile(r'(?:cite)?(?:i)?turn\d+(?:search|image|news|file)\d+'), 'chatgpt:turn-artifact'),
    # :contentReference[oaicite:0]{index=0}
    (re.compile(r'contentReference\s*\[oaicite:', re.I), 'chatgpt:contentReference'),
    # oaicite:0 or oaicite:N (standalone)
    (re.compile(r'\boaicite:\d', re.I), 'chatgpt:oaicite'),
    # [oai_citation:0‡source.com]
    (re.compile(r'\boai_citation:', re.I), 'chatgpt:oai-citation'),
    # ({"attribution":{"attributableIndex":"1-0"}})
    (re.compile(r'\{"attribution":\s*\{"attributableIndex":', re.I), 'chatgpt:attribution-json'),
    # access-date=2025-xx-xx (placeholder date in citation)
    (re.compile(r'access-date\s*=\s*\d{4}-xx-xx'), 'chatgpt:date-placeholder'),
]

# Prompt refusals — AI self-identification phrases that must not appear in prose
_REFUSALS = [
    (re.compile(r'\bAs an AI language model\b', re.I), 'refusal:ai-language-model'),
    (re.compile(r'\bAs a large language model\b', re.I), 'refusal:large-language-model'),
    # "I cannot provide" — first-person refusal; very unlikely in legal writing (which avoids "I")
    (re.compile(r'\bI cannot (?:provide|assist|help|generate|write)\b'), 'refusal:cannot-provide'),
    # "I hope this helps" — chatbot sign-off leaked into document body
    (re.compile(r'\bI hope this (?:helps|email finds)\b', re.I), 'refusal:i-hope-this-helps'),
]

# Unfilled template placeholders — author forgot to fill in the blank
_PLACEHOLDERS = [
    (re.compile(r'\[YOUR[\s_]NAME\]', re.I), 'template:your-name'),
    # [INSERT SOMETHING HERE] or [INSERT NAME HERE] etc.
    (re.compile(r'\[INSERT\b[^\]]{0,50}\]', re.I), 'template:insert-placeholder'),
    (re.compile(r'\[PLACEHOLDER\]', re.I), 'template:placeholder'),
    # [TODO] or [TODO: text] — unfilled stub in prose body
    (re.compile(r'\[TODO\b[^\]]{0,60}\]', re.I), 'template:todo'),
]

_ALL_PATTERNS = _CHATGPT_ARTIFACTS + _REFUSALS + _PLACEHOLDERS

_FRONTMATTER_DELIM = re.compile(r'^---\s*$')
_FENCE = re.compile(r'^(?:```|~~~)')
_BLOCKQUOTE = re.compile(r'^\s*>')
_FOOTNOTE_DEF = re.compile(r'^\s*\[\^')
_HTML_COMMENT_OPEN = re.compile(r'<!--')
_HTML_COMMENT_CLOSE = re.compile(r'-->')


def _prose_lines(text):
    """Yield (1-indexed line number, line) for prose-only content.

    Skips: YAML frontmatter, fenced code blocks, blockquotes,
    footnote definitions, and HTML comments (editorial notes).
    """
    lines = text.splitlines()
    in_frontmatter = False
    frontmatter_done = False
    in_fence = False
    in_html_comment = False

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
            continue
        if in_fence:
            continue

        if _BLOCKQUOTE.match(line):
            continue
        if _FOOTNOTE_DEF.match(line):
            continue

        yield i, line


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    drafts_dir = cwd / "drafts"
    if not drafts_dir.is_dir():
        return violations

    for md_file in sorted(drafts_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8", errors="ignore")
        for lineno, line in _prose_lines(text):
            for pat, label in _ALL_PATTERNS:
                if pat.search(line):
                    snippet = line.strip()[:80]
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
