#!/usr/bin/env -S uv run --with pymupdf4llm python3
"""Build the human-writing control corpus from pre-2020 domain PDFs.

The negatives set must be GENUINE HUMAN prose in the genre the hook guards
(law-review / finance-econ articles) and PRE-2020 to guarantee no LLM
contamination. This script extracts text from a set of PDFs to
corpus/human/<slug>.txt (committed), so eval/fp-hunt stay offline.

Sources, in priority order:
  1. PDFs whose paths are passed on the command line.
  2. The user's Paperpile collection, filtered to filenames with a pre-2020
     year (Paperpile names files "Author YEAR - Title.pdf").

Body text only: we drop everything before the first paragraph-length block and
after a "References"/"Bibliography" heading, and skip short lines (headings,
page numbers, footnote refs) so the negatives are clean running prose.

Usage:
  build_corpus.py --paperpile --max 40           # mine 40 pre-2020 domain PDFs
  build_corpus.py path/to/a.pdf path/to/b.pdf    # explicit files
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO_ROOT / "corpus" / "human"
PAPERPILE = Path.home() / "Google Drive" / "My Drive" / "resources" / \
    "Paperpile" / "All Papers"

# Pre-2020 4-digit year in a Paperpile filename ("Author 2014 - Title.pdf").
_YEAR_RE = re.compile(r"\b(19\d{2}|20[01]\d)\b")
_REFS_RE = re.compile(r"^\s*#*\s*(references|bibliography|works\s+cited)\s*$", re.I)
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(name: str) -> str:
    return _SLUG_RE.sub("-", name.lower()).strip("-")[:60]


def _pre2020_paperpile(limit: int) -> list[Path]:
    if not PAPERPILE.is_dir():
        return []
    out: list[Path] = []
    for pdf in PAPERPILE.rglob("*.pdf"):
        m = _YEAR_RE.search(pdf.name)
        if m and int(m.group(1)) <= 2019:
            out.append(pdf)
            if len(out) >= limit:
                break
    return out


def _extract_body(pdf: Path) -> str:
    import pymupdf4llm
    md = pymupdf4llm.to_markdown(str(pdf), show_progress=False)
    lines = md.splitlines()
    kept: list[str] = []
    for ln in lines:
        if _REFS_RE.match(ln):
            break  # stop at the bibliography
        s = ln.strip()
        # Keep paragraph-length prose only; drop headings, page numbers, tables.
        if len(s) < 60 or s.startswith(("#", "|", "*", "-", ">")):
            continue
        if s.count("|") > 1 or re.fullmatch(r"[\d\s.,\-]+", s):
            continue
        kept.append(s)
    return "\n".join(kept)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="*", type=Path)
    ap.add_argument("--paperpile", action="store_true",
                    help="mine pre-2020 PDFs from the Paperpile collection")
    ap.add_argument("--max", type=int, default=40)
    ap.add_argument("--min-chars", type=int, default=2000,
                    help="skip a PDF whose extracted body is shorter than this")
    args = ap.parse_args()

    pdfs = list(args.pdfs)
    if args.paperpile:
        pdfs += _pre2020_paperpile(args.max)
    if not pdfs:
        sys.exit("no PDFs — pass paths or --paperpile")

    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for pdf in pdfs[: args.max]:
        try:
            body = _extract_body(pdf)
        except Exception as e:
            print(f"  skip {pdf.name}: {e}", file=sys.stderr)
            continue
        if len(body) < args.min_chars:
            print(f"  skip {pdf.name}: only {len(body)} chars", file=sys.stderr)
            continue
        dest = CORPUS_DIR / f"{_slug(pdf.stem)}.txt"
        dest.write_text(body, encoding="utf-8")
        written += 1
        print(f"  + {dest.name} ({len(body):,} chars)")
    print(f"\nwrote {written} corpus file(s) to {CORPUS_DIR}")


if __name__ == "__main__":
    main()
