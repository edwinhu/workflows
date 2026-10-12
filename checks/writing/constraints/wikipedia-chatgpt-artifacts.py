#!/usr/bin/env -S uv run python3
"""Constraint: ai-chatgpt-artifacts — detect ChatGPT-specific citation and markup artifacts."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # _writing: the contract, prose_extract
from _writing import main, prose, prose_extract
from _writing import rel as _rel

CONSTRAINT = "wikipedia-chatgpt-artifacts"
SEVERITY = "hard"  # These artifacts must be removed — they expose AI provenance unambiguously
AUDIT_SYSTEM = "wikipedia-chatgpt-artifacts"  # prose-audit.py's system for these tables (default: the directory's style guide)
AUDIT_ORDER = 4  # prose-audit.py's load order among declared systems: the first names a span tied tables match
AUDIT_IGNORE_CASE = False  # matched case-sensitively, exactly as check() does

# ABSORBED writing-ai-smell-artifacts (v5.127.0) — see the merge note in
# wikipedia-puffery-and-exaggeration.py. Nearly all of it duplicated this table and
# wikipedia-template-artifacts.py; the one improvement was a wider `turn` placeholder, taken below.
_ARTIFACT_PATTERNS = [
    # ChatGPT citation placeholders. [ex-ai-smell] widened from two rules matching only
    # search/image to one covering news and file, and the `iturn…` variant the web UI also emits.
    (r'\b(cite)?(i)?turn\d+(search|image|news|file)\d+\b',
     "ChatGPT artifact: citeturn0search0 citation placeholder"),
    # oaicite / contentReference artifacts
    (r':contentReference\[oaicite:\d+\]', "ChatGPT artifact: :contentReference[oaicite:X]"),
    (r'\[oai_citation:\d+', "ChatGPT artifact: [oai_citation:X‡...]"),
    (r'\boaicite\b', "ChatGPT artifact: oaicite marker"),
    # Attribution JSON
    (r'attributableIndex', "ChatGPT artifact: attributableIndex JSON"),
    (r'"attribution"\s*:\s*\{', "ChatGPT artifact: attribution JSON object"),
    # Footnote backlink arrows (ChatGPT footnote formatting)
    (r'↩\s*(<sup>|$)', "ChatGPT artifact: ↩ backlink arrow in footnote"),
    # utm_source=chatgpt in URLs
    (r'utm_source=(chatgpt|openai)(\.com)?', "ChatGPT artifact: utm_source=chatgpt tracking URL"),
    # endoftext token
    (r'<\|endoftext\|>', "AI artifact: <|endoftext|> token in output"),
    # Gemini/Bard artifacts
    (r'\[CITATION\]\s*\(https://bard\.google', "Bard artifact: Bard citation link"),
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    files = context["files"]  # the prose files handed in, wherever they lie

    if not files:
        return violations

    for path in files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        rel = _rel(path, cwd)
        for i, line in line_iter:
            for pattern, label in _ARTIFACT_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"{rel}:{i}: {label}")
    return violations


if __name__ == "__main__":
    raise SystemExit(main(CONSTRAINT, check, prose))
