#!/usr/bin/env -S uv run python3
"""Detect typographic widows in a compiled law-review PDF.

A typographic widow is a paragraph's last line containing only 1-2 short words.
This script extracts text from the PDF via `pdftotext -layout`, walks the
paragraphs, and flags short last lines that sit under the main column (i.e.,
not footnote columns, tables, running headers, or page numbers).

Companion to `build_docx.py --pdf`. Run after compiling to PDF, iterate on
nbsp binding or rewording, recompile, rerun.

Usage:
    check_widows.py PDF [--max-words N] [--min-prev-chars N] [--verbose]

Flags:
    --max-words N       Lines with ≤N words flag as widows (default: 2)
    --min-prev-chars N  Skip paragraphs whose penultimate line is shorter than
                        N chars — these are usually tables (default: 20)
    --verbose           Also show false-positive candidates (page numbers,
                        headers, table cells) that were filtered out
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# Patterns that indicate the last line is NOT a real widow
FALSE_POSITIVE_PATTERNS = [
    re.compile(r'^\d+$'),                          # bare page number
    re.compile(r'^MIRROR VOTING$', re.IGNORECASE), # running header (project-specific)
    re.compile(r'^[\d,.]+%?$'),                    # numeric table cell
    re.compile(r'^[A-Z][a-z]+ \d{4}$'),            # title-page date like "April 2026"
    re.compile(r'^Other mgmt$'),                   # table cell label
]

# URL tail-fragment patterns: a widowed URL continuation (e.g., after a
# hyphen-break in a long URL path). Legal footnotes often carry long URLs,
# and URL widows are generally accepted. Flag with --include-urls to see them.
URL_WIDOW_PATTERN = re.compile(
    r'^[a-z0-9]+([-/][a-z0-9./]+)*(\.|/|\.\s*\)?)$',
    re.IGNORECASE,
)


def looks_like_url_fragment(last: str, prev: str) -> bool:
    """Return True if the widow appears to be a URL continuation."""
    # Previous line ends with '-' or '/' suggesting a URL broken at those chars.
    prev_stripped = prev.rstrip()
    if prev_stripped.endswith('-') or prev_stripped.endswith('/'):
        # Does prev look URL-ish? Check for domain markers or http
        if re.search(r'https?://|www\.|\.com|\.edu|\.org|\.gov', prev_stripped):
            return True
    # Or: last-line token looks like a URL path continuation
    if URL_WIDOW_PATTERN.match(last) and re.search(r'https?://|[a-z]\.(edu|com|org|gov)', prev):
        return True
    return False


def is_false_positive(last_line: str, running_header: str | None = None) -> bool:
    """Return True if the last line is a known non-widow artifact."""
    if running_header and last_line == running_header:
        return True
    for pat in FALSE_POSITIVE_PATTERNS:
        if pat.match(last_line):
            return True
    return False


def detect_widows(
    pdf_path: Path,
    max_words: int = 1,
    min_prev_chars: int = 20,
    running_header: str | None = None,
    include_urls: bool = False,
) -> list[tuple[str, str]]:
    """Extract paragraphs and return (prev_tail, widow) pairs.

    Two classes of widow:
      (1) Paragraph-end widow: last line of a paragraph has ≤ max_words words.
      (2) Page-level widow: a paragraph's final line sits alone at the top of
          a new page (the rest of the paragraph is on the previous page).

    Uses `pdftotext -layout`; form-feed (`\\f`) delimits pages.
    """
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True, text=True, check=True,
    )
    text = result.stdout

    widows: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add_widow(prev_line: str, last_line: str):
        key = (prev_line.strip()[-60:], last_line)
        if key in seen:
            return
        seen.add(key)
        widows.append((prev_line.strip(), last_line))

    # --- (1) Paragraph-end widows (whole document collapsed) ---
    # pdftotext -layout separates paragraphs in two ways:
    #   (a) a blank line between paragraphs, OR
    #   (b) the first line of each new paragraph carries a leading indent
    #       (2+ leading spaces), while continuation lines sit at column 0.
    # We detect BOTH signals so we don't lump adjacent paragraphs together.
    paragraphs: list[list[str]] = []
    current: list[str] = []

    def close_current():
        nonlocal current
        if current:
            paragraphs.append(current)
            current = []

    def is_new_paragraph_indent(line: str) -> bool:
        # True if this line's leading whitespace suggests a new paragraph start.
        if not line.strip():
            return False
        leading = len(line) - len(line.lstrip(" "))
        return leading >= 2

    for raw_line in text.split("\n"):
        # Split on form feed in case pdftotext packs multiple pages on one line
        segments = re.split(r"\f", raw_line)
        for seg in segments:
            if not seg.strip():
                close_current()
                continue
            if is_new_paragraph_indent(seg) and current:
                close_current()
            current.append(seg.rstrip())
    close_current()

    for p in paragraphs:
        if len(p) < 2:
            continue
        last = p[-1].strip()
        words = last.split()
        if not words or len(words) > max_words:
            continue
        if is_false_positive(last, running_header):
            continue
        prev = p[-2]
        if not include_urls and looks_like_url_fragment(last, prev):
            continue
        prev_stripped = prev.strip()
        if re.search(r"\s{3,}", prev):
            continue
        if len(prev_stripped) < min_prev_chars:
            continue
        add_widow(prev_stripped, last)

    # --- (2) Page-level widows ---
    # For each page (after page 1), locate the first non-blank prose block
    # on the page. If that block has just 1 line AND ends with sentence-
    # ending punctuation (indicating it's the tail of a paragraph continuing
    # from the previous page), flag as a page widow.
    pages = text.split("\f")
    for page_idx, page in enumerate(pages):
        if page_idx == 0:
            continue
        # Pull paragraphs within this page
        page_paras: list[list[str]] = []
        cur: list[str] = []
        for ln in page.split("\n"):
            if ln.strip():
                cur.append(ln.rstrip())
            else:
                if cur:
                    page_paras.append(cur)
                    cur = []
        if cur:
            page_paras.append(cur)
        # Find first "body" paragraph (skip running header, page number)
        first_body = None
        for pp in page_paras:
            combined = " ".join(ln.strip() for ln in pp).strip()
            if running_header and combined == running_header:
                continue
            if combined.isdigit():
                continue
            # Skip short headings / captions: less than 30 chars AND no terminal punctuation
            if len(combined) < 30 and not re.search(r"[.!?]\s*$", combined):
                continue
            first_body = pp
            break
        if first_body is None or len(first_body) > 1:
            continue
        page_widow_line = first_body[0].strip()
        # Must look like the END of a sentence (has terminal punctuation)
        # Strip footnote superscripts like ¹ ² ³ and bracketed fn markers
        test = re.sub(r"\s*[¹²³⁰-₟⁵-⁹]*\s*$", "", page_widow_line).rstrip()
        if not re.search(r"[.!?]\s*[\'\"\)\]]*\s*$", test):
            continue
        if is_false_positive(page_widow_line, running_header):
            continue
        # Skip obvious URL tails
        prev_page = pages[page_idx - 1] if page_idx > 0 else ""
        prev_body_last = ""
        for ln in reversed(prev_page.split("\n")):
            s = ln.strip()
            if not s:
                continue
            if running_header and s == running_header:
                continue
            if re.match(r"^\d+\s*$", s):
                continue
            if re.match(r"^_+$", s):  # footnote separator
                continue
            prev_body_last = s
            break
        if not include_urls and looks_like_url_fragment(page_widow_line, prev_body_last):
            continue
        add_widow(prev_body_last or "[previous page]", page_widow_line)

    return widows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdf", type=Path, help="Path to compiled PDF")
    ap.add_argument("--max-words", type=int, default=1,
                    help="Flag last lines with ≤ this many words (default: 1). "
                         "Single-word widows are the real problem; 2-word widows are "
                         "usually tolerable and sometimes unavoidable without substantive "
                         "rewording. Raise to 2 for stricter checking.")
    ap.add_argument("--min-prev-chars", type=int, default=20,
                    help="Skip if penultimate line shorter than this (default: 20)")
    ap.add_argument("--header", type=str, default=None,
                    help="Running-header text to treat as non-widow (e.g., 'MIRROR VOTING')")
    ap.add_argument("--include-urls", action="store_true",
                    help="Also flag widows that appear to be URL continuations "
                         "(default: skipped; URL widows are standard in legal footnotes)")
    ap.add_argument("--verbose", action="store_true",
                    help="Also print filtered false-positive candidates")
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f"ERROR: {args.pdf} not found", file=sys.stderr)
        return 1

    widows = detect_widows(
        args.pdf,
        max_words=args.max_words,
        min_prev_chars=args.min_prev_chars,
        running_header=args.header,
        include_urls=args.include_urls,
    )

    if not widows:
        print(f"No widows found in {args.pdf.name} (≤{args.max_words} words on last line).")
        return 0

    print(f"Found {len(widows)} widows in {args.pdf.name}:\n")
    for prev, last in widows:
        tail = prev[-90:] if len(prev) > 90 else prev
        print(f"  ...{tail}")
        print(f"     >>> {last} <<<\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
