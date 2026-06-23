#!/usr/bin/env -S uv run --with pymupdf python3
"""Parallel human-corpus harvester (scale-up of build_corpus.py).

Extracts body text from a directory of PDFs into corpus/human/*.txt using a
ProcessPoolExecutor — PDF parsing is CPU-bound, so this is the right executor
(per the project concurrency rules). Scanned PDFs (no text layer) are dropped by
a per-document min-chars threshold; the text-layer survey found these are ~3% of
the collection, concentrated in the oldest cohort.

Uses raw PyMuPDF `page.get_text()` (NOT pymupdf4llm.to_markdown): for n-gram
counting we want words, not layout, and plain extraction is 10-50x faster — the
difference between minutes and hours over ~13k articles. Results are collected
with `as_completed` (out of order) so one slow/malformed PDF cannot stall the
write pipeline, and each PDF runs under a SIGALRM watchdog so a hang in the C
layer (e.g. a broken LZW stream) is bounded rather than wedging a worker.

Usage:
  harvest.py /path/to/pdfs/*.pdf
  harvest.py --dir /path/to/pdfs --out /data/.../corpus --workers 60 --skip-existing
"""

from __future__ import annotations

import argparse
import os
import re
import signal
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO_ROOT / "corpus" / "human"

_REFS_RE = re.compile(r"^\s*(references|bibliography|works\s+cited)\s*$", re.I)
_SLUG_RE = re.compile(r"[^a-z0-9]+")
_NUMERIC_RE = re.compile(r"[\d\s.,\-]+$")

_PER_PDF_TIMEOUT = 45  # seconds; a single PDF may not exceed this


def _slug(name: str) -> str:
    return _SLUG_RE.sub("-", name.lower()).strip("-")[:70]


def extract_body(pdf_path: str) -> str:
    """Top-level (picklable) extractor: PDF -> clean running prose via raw
    get_text(). Keeps paragraph-length lines, drops headings / page furniture /
    digit-heavy table rows, and stops at the bibliography."""
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    kept: list[str] = []
    for page in doc:
        for raw in page.get_text().splitlines():
            s = raw.strip()
            if _REFS_RE.match(s):
                doc.close()
                return "\n".join(kept)
            if len(s) < 60 or _NUMERIC_RE.match(s):
                continue
            # Drop digit-heavy rows (tables, regression output).
            if sum(c.isdigit() for c in s) > len(s) * 0.3:
                continue
            kept.append(s)
    doc.close()
    return "\n".join(kept)


def _timeout(_signum, _frame):
    raise TimeoutError("per-PDF timeout")


def _one(args):
    pdf_path, min_chars = args
    try:
        signal.signal(signal.SIGALRM, _timeout)
        signal.alarm(_PER_PDF_TIMEOUT)
    except (ValueError, OSError):
        pass  # not in main thread of a worker — rare; proceed without watchdog
    try:
        body = extract_body(pdf_path)
    except Exception as e:  # noqa: BLE001
        return (pdf_path, None, f"err: {type(e).__name__}")
    finally:
        try:
            signal.alarm(0)
        except (ValueError, OSError):
            pass
    if len(body) < min_chars:
        return (pdf_path, None, "short")
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
    total = len(work)
    print(f"harvesting {total} PDFs with {args.workers} workers -> {out_dir}",
          flush=True)
    # as_completed: results stream back out of order, so one slow/hung PDF never
    # blocks writes for the rest (the bug that stalled the pymupdf4llm run).
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(_one, w) for w in work]
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                pdf_path, body, err = fut.result()
            except Exception:  # noqa: BLE001
                skipped += 1
                continue
            if body is None:
                skipped += 1
            else:
                (out_dir / _outname(pdf_path)).write_text(body, encoding="utf-8")
                written += 1
            if i % 1000 == 0:
                print(f"  …{i}/{total} (wrote {written}, skipped {skipped})",
                      flush=True)
    print(f"DONE: wrote {written}, skipped {skipped} -> {out_dir}", flush=True)


if __name__ == "__main__":
    main()
