#!/usr/bin/env -S uv run python3
"""Constraint: ai-chatgpt-artifacts — detect ChatGPT-specific citation and markup artifacts."""
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

CONSTRAINT = "wikipedia-chatgpt-artifacts"
APPLIES_TO = ["writing-draft", "writing-verify", "writing-revise", "writing-validate"]
SEVERITY = "hard"  # These artifacts must be removed — they expose AI provenance unambiguously

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


def _find_all_writing_files(cwd):
    """Check all writing output files including planning artifacts. ChatGPT
    artifacts (``turn0search0`` etc.) can leak into any stage, so this widens
    the discovery to revisions/ and .planning/ on top of drafts/+outlines/."""
    paths = list(prose_extract.find_draft_files(cwd))
    # Extras beyond the standard {drafts,outlines}/{*.md,*.docx,*.txt} surface
    revisions = cwd / "revisions"
    if revisions.is_dir():
        for g in prose_extract.DRAFT_GLOBS:
            paths.extend(revisions.glob(g))
    planning = cwd / ".planning"
    if planning.is_dir():
        for g in prose_extract.DRAFT_GLOBS:
            paths.extend(planning.glob(g))
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

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        rel = path.relative_to(cwd)
        for i, line in line_iter:
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
