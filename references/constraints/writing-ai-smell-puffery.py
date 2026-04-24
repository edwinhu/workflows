#!/usr/bin/env -S uv run python3
"""Constraint: writing-ai-smell-puffery — flag AI puffery and promotional language in prose drafts."""

import re
import sys
from pathlib import Path

CONSTRAINT = "writing-ai-smell-puffery"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise"]
SEVERITY = "soft"

# Each entry: (compiled_regex, label)
# Ordered from highest precision (rare in legitimate prose) to lower precision (more FP risk)
_PATTERNS = [
    # Near-certain AI tells — extremely rare in legitimate academic/legal prose
    (re.compile(r'\bdelves?\s+into\b', re.I), 'puffery:delves-into'),
    (re.compile(r'\brich\s+tapestry\b', re.I), 'puffery:rich-tapestry'),
    (re.compile(r'\bnestled\b', re.I), 'puffery:nestled'),
    # Strong AI tells — FP risk in regulatory/antitrust writing; review in context
    (re.compile(r'\bstands?\s+as\s+(?:a|an|the)\b', re.I), 'puffery:stands-as'),
    (re.compile(r'\bplays?\s+a\s+(?:vital|crucial|pivotal|key|central)\s+role\b', re.I), 'puffery:plays-X-role'),
    (re.compile(r'\bit\s+is\s+important\s+to\s+note\b', re.I), 'puffery:important-to-note'),
    (re.compile(r'\bit\s+is\s+worth\s+noting\b', re.I), 'puffery:worth-noting'),
    # v2: "it should be noted that" — puffery sibling; already has "important to note" and "worth noting"
    (re.compile(r'\bit\s+should\s+be\s+noted\s+that\b', re.I), 'puffery:should-be-noted'),
    # Promotional language — soft signals; review in context
    (re.compile(r'\bcutting[- ]edge\b', re.I), 'promo:cutting-edge'),
    (re.compile(r'\bunparalleled\b', re.I), 'promo:unparalleled'),
]

# v2: Promotional superlatives — fire only when modifying the author's own work.
# Heuristic: flag when a superlative word and a self-contribution word appear within
# 60 characters of each other on the same line.
# This avoids false positives like "unprecedented federal intervention" or
# "transformative use doctrine" where the superlative describes an external event.
_SUPERLATIVES = re.compile(
    r'\b(unprecedented|transformative|revolutionary|groundbreaking)\b', re.I
)
_SELF_CONTRIBUTION = re.compile(
    r'\b(article|analysis|framework|finding|approach|paper|argument|thesis|'
    r'contribution|study|research|theory|claim|argument)\b',
    re.I
)


def _superlative_self_attr(line):
    """Return (superlative_word, match) if line uses a superlative near a self-contribution noun."""
    m = _SUPERLATIVES.search(line)
    if not m:
        return None
    # Look within 60 chars on either side of the superlative
    start = max(0, m.start() - 60)
    end = min(len(line), m.end() + 60)
    window = line[start:end]
    if _SELF_CONTRIBUTION.search(window):
        return m.group().lower()
    return None


# Intentionally excluded as general patterns — too many false positives in legal writing:
# - 'unprecedented' (legal term of art) — covered by superlative self-attr heuristic
# - 'transformative' (copyright doctrine) — covered by superlative self-attr heuristic
# - 'revolutionary' (historical and legal usage) — covered by superlative self-attr heuristic
# - 'groundbreaking' — moved from general to superlative self-attr heuristic
# - 'state-of-the-art' (IP/patent term)
# - filler transitions: 'Furthermore,', 'Moreover,' — handled by writing-ai-smell-structure
# - 'the landscape of' (regulatory landscape is legitimate)

_FRONTMATTER_DELIM = re.compile(r'^---\s*$')
_FENCE = re.compile(r'^(?:```|~~~)')
_BLOCKQUOTE = re.compile(r'^\s*>')
_FOOTNOTE_DEF = re.compile(r'^\s*\[\^')
_HTML_COMMENT_OPEN = re.compile(r'<!--')
_HTML_COMMENT_CLOSE = re.compile(r'-->')


def _prose_lines(text):
    """Yield (1-indexed line number, line) for prose-only content.

    Skips: YAML frontmatter, fenced code blocks, blockquotes (quoted source material),
    footnote definitions, and HTML comments (which may contain editorial REVIEW notes).
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
            # General puffery patterns
            for pat, label in _PATTERNS:
                if pat.search(line):
                    snippet = line.strip()[:80]
                    violations.append(
                        f"drafts/{md_file.name}:{lineno}: [{label}] {snippet!r}"
                    )
            # Superlative self-attribution heuristic
            word = _superlative_self_attr(line)
            if word:
                snippet = line.strip()[:80]
                violations.append(
                    f"drafts/{md_file.name}:{lineno}: [promo:superlative:{word}] {snippet!r}"
                )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
