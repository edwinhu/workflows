#!/usr/bin/env python3
"""Constraint: ai-chatgpt-artifacts — detect ChatGPT-specific citation and markup artifacts."""
import re
import sys
from pathlib import Path

CONSTRAINT = "wikipedia-chatgpt-artifacts"
APPLIES_TO = ["writing-draft", "writing-review", "writing-revise", "writing-validate"]
SEVERITY = "hard"  # These artifacts must be removed — they expose AI provenance unambiguously

_ARTIFACT_PATTERNS = [
    # ChatGPT citation placeholders
    (r'\b(cite)?turn\d+search\d+\b', "ChatGPT artifact: citeturn0search0 citation placeholder"),
    (r'\b(cite)?turn\d+image\d+\b', "ChatGPT artifact: turn0image0 citation placeholder"),
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


def _find_all_writing_files(cwd):
    """Check all writing output files including planning artifacts."""
    paths = []
    for subdir in ("drafts", "outlines", "revisions"):
        d = cwd / subdir
        if d.is_dir():
            paths.extend(d.glob("*.md"))
    planning = cwd / ".planning"
    if planning.is_dir():
        paths.extend(planning.glob("*.md"))
    return paths


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    files = _find_all_writing_files(cwd)

    if not files:
        return violations

    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = path.relative_to(cwd)
        for i, line in enumerate(text.splitlines(), start=1):
            for pattern, label in _ARTIFACT_PATTERNS:
                if re.search(pattern, line):
                    violations.append(f"{rel}:{i}: {label}")
    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
