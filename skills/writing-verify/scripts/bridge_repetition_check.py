#!/usr/bin/env -S uv run python3
"""Detect near-duplicate sentences within the same section.

A common model failure is restating the thesis paragraph when transitioning
to the next section — a "bridge repetition." This is structural, not
diction, so prose linters miss it.

Uses `difflib.SequenceMatcher` ratio ≥ threshold (default 0.7). Reports
each flagged pair as `file:line` for human review. Some pairs will be
intentional (e.g., two sides of a numerical example); the human decides.

Usage:
    uv run bridge_repetition_check.py drafts/*.md
    uv run bridge_repetition_check.py --threshold 0.8 drafts/*.md
    uv run bridge_repetition_check.py --min-length 60 drafts/*.md
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path

_SENT_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


def _strip_nonprose(text: str) -> str:
    """Remove frontmatter, footnote bodies, code fences, tables, headings.

    Keeps only running prose. Returns a single-string blob with newlines
    collapsed so sentence splitting works across paragraph breaks.
    """
    text = re.sub(r"^---.*?---\n", "", text, count=1, flags=re.DOTALL)
    kept = []
    in_code = False
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        if stripped.startswith("[^"):
            continue
        if stripped.startswith(("|", "#", "<!--", ":::")):
            continue
        kept.append(line)
    merged = " ".join(kept)
    return re.sub(r"\s+", " ", merged).strip()


def _sentences(text: str, min_length: int) -> list[str]:
    prose = _strip_nonprose(text)
    return [s.strip() for s in _SENT_BOUNDARY.split(prose) if len(s.strip()) >= min_length]


def _locate(text: str, sentence: str) -> int:
    """Return the 1-indexed line number where `sentence` first appears.

    Matches on the first 40 characters to survive minor whitespace rewriting
    during sentence normalization.
    """
    needle = sentence[:40].strip()
    if not needle:
        return 0
    for i, line in enumerate(text.splitlines(), 1):
        if needle in line:
            return i
    return 0


def find_near_duplicates(
    text: str,
    threshold: float = 0.7,
    min_length: int = 40,
) -> list[tuple[float, int, int, str, str]]:
    """Return `(ratio, line_a, line_b, sentence_a, sentence_b)` for each pair."""
    sents = _sentences(text, min_length)
    hits = []
    for i in range(len(sents)):
        for j in range(i + 1, len(sents)):
            ratio = difflib.SequenceMatcher(None, sents[i], sents[j]).ratio()
            if ratio >= threshold:
                line_a = _locate(text, sents[i])
                line_b = _locate(text, sents[j])
                hits.append((ratio, line_a, line_b, sents[i], sents[j]))
    hits.sort(key=lambda h: -h[0])
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flag near-duplicate sentences within the same file.",
    )
    parser.add_argument("files", nargs="+", type=Path, help="Markdown files.")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.7,
        help="difflib SequenceMatcher ratio (default: 0.7).",
    )
    parser.add_argument(
        "--min-length",
        type=int,
        default=40,
        help="Minimum sentence length in chars (default: 40).",
    )
    parser.add_argument(
        "--max-per-file",
        type=int,
        default=10,
        help="Limit pairs reported per file (default: 10).",
    )
    args = parser.parse_args()

    any_hits = False
    for path in args.files:
        text = path.read_text()
        hits = find_near_duplicates(text, args.threshold, args.min_length)
        if not hits:
            continue
        any_hits = True
        print(f"\n=== {path} ({len(hits)} pair(s) ≥ {args.threshold}) ===")
        for ratio, la, lb, a, b in hits[: args.max_per_file]:
            print(f"  ratio={ratio:.2f}  {path}:{la}  vs  {path}:{lb}")
            print(f"    A: {a[:180]}")
            print(f"    B: {b[:180]}")
    return 1 if any_hits else 0


if __name__ == "__main__":
    sys.exit(main())
