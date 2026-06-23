#!/usr/bin/env -S uv run --with pymupdf4llm python3
"""Parallel human-corpus harvester (scale-up of build_corpus.py).

Extracts body text from a directory of PDFs into corpus/human/*.txt using a
ProcessPoolExecutor — PDF parsing is CPU-bound, so this is the right executor
(per the project concurrency rules). Scanned PDFs (no text layer) are dropped by
a per-document min-chars threshold; the text-layer survey found these are ~3% of
the collection, concentrated in the oldest cohort.

Usage:
  harvest.py /path/to/pdfs/*.pdf
  harvest.py --dir /path/to/pdfs --workers 8 --min-chars 4000
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO_ROOT / "corpus" / "human"

_REFS_RE = re.compile(r"^\s*#*\s*(references|bibliography|works\s+cited)\s*$", re.I)
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(name: str) -> str:
    return _SLUG_RE.sub("-", name.lower()).strip("-")[:70]


def extract_body(pdf_path: str) -> str:
    """Top-level (picklable) extractor: PDF -> clean running prose."""
    import pymupdf4llm
    md = pymupdf4llm.to_markdown(pdf_path, show_progress=False)
    kept = []
    for ln in md.splitlines():
        if _REFS_RE.match(ln):
            break
        s = ln.strip()
        if len(s) < 60 or s.startswith(("#", "|", "*", "-", ">")):
            continue
        if s.count("|") > 1 or re.fullmatch(r"[\d\s.,\-]+", s):
            continue
        kept.append(s)
    return "\n".join(kept)


def _one(args):
    pdf_path, min_chars = args
    try:
        body = extract_body(pdf_path)
    except Exception as e:  # noqa: BLE001
        return (pdf_path, None, f"err: {e}")
    if len(body) < min_chars:
        return (pdf_path, None, f"short ({len(body)})")
    return (pdf_path, body, None)


def _outname(pdf_path: str) -> str:
    """`<parentdir>_<slug>.txt` so the journal (parent folder) survives as a
    filename prefix — useful for per-journal slicing later. Falls back to the
    bare slug when there is no meaningful parent."""
    p = Path(pdf_path)
    parent = p.parent.name
    stem = _slug(p.stem)
    return f"{_slug(parent)}_{stem}.txt" if parent and parent != "." else f"{stem}.txt"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="*", type=str)
    ap.add_argument("--dir", help="directory of PDFs (recursed for *.pdf)")
    ap.add_argument("--out", default=str(CORPUS_DIR),
                    help="output dir for *.txt (default: repo corpus/human)")
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4) - 2))
    ap.add_argument("--min-chars", type=int, default=4000)
    ap.add_argument("--skip-existing", action="store_true",
                    help="resume: skip PDFs whose output .txt already exists")
    args = ap.parse_args()

    pdfs = list(args.pdfs)
    if args.dir:
        pdfs += [str(p) for p in Path(args.dir).rglob("*.pdf")]
    if not pdfs:
        sys.exit("no PDFs — pass paths or --dir")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.skip_existing:
        pdfs = [p for p in pdfs if not (out_dir / _outname(p)).exists()]
    work = [(p, args.min_chars) for p in pdfs]
    written = skipped = 0
    print(f"harvesting {len(work)} PDFs with {args.workers} workers -> {out_dir}",
          flush=True)
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for i, (pdf_path, body, err) in enumerate(
                ex.map(_one, work, chunksize=8), 1):
            if body is None:
                skipped += 1
            else:
                (out_dir / _outname(pdf_path)).write_text(body, encoding="utf-8")
                written += 1
            if i % 500 == 0:
                print(f"  …{i}/{len(work)} (wrote {written}, skipped {skipped})",
                      flush=True)
    print(f"DONE: wrote {written}, skipped {skipped} -> {out_dir}", flush=True)


if __name__ == "__main__":
    main()
