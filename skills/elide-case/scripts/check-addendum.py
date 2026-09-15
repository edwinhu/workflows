#!/usr/bin/env python3
"""Verify an addendum's summary table against its compiled PDF.

Usage: check-addendum.py <addendum.typ> <compiled.pdf>
           [--target MIN-MAX] [--targets <file>]

Checks, in order:
  1. arity      — table rows == per-reading caption blocks
  2. table truth— each row's stated "pp. A--B" == the range computed from the PDF
  3. length     — each reading's page count within its target (optional)

--targets names a file of '<1-based reading index>\t<MIN-MAX>' lines and is how a
per-reading target reaches this script; check.sh writes it from the plan's
'## Readings In Scope' table. --target applies one range to every reading and is
the --no-plan (fixture, dev) form.

Exit 0 on all-pass, 1 on any failure. On success prints the computed table rows
in Typst syntax so the caller pastes computed output instead of retyping.
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------- typ parsing


def read_typ(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _match_bracket(src: str, open_at: int, opener: str, closer: str) -> int:
    """Index just past the balanced closer for the delimiter at open_at."""
    depth = 0
    i = open_at
    while i < len(src):
        c = src[i]
        if c == "\\":
            i += 2
            continue
        if c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError(f"unbalanced {opener!r} starting at offset {open_at}")


def split_cells(body: str) -> list[str]:
    """Split a #table(...) body into its top-level [...] cells, in order."""
    cells = []
    i = 0
    while i < len(body):
        if body[i] == "[":
            end = _match_bracket(body, i, "[", "]")
            cells.append(body[i + 1 : end - 1].strip())
            i = end
        else:
            i += 1
    return cells


def parse_table_rows(src: str) -> list[dict]:
    """Rows of the summary table after table.header: (class, reading, pages)."""
    m = re.search(r"#table\(", src)
    if not m:
        raise SystemExit("FAIL parse: no #table( found in the .typ")
    body_start = m.end() - 1
    body_end = _match_bracket(src, body_start, "(", ")")
    body = src[body_start + 1 : body_end - 1]

    h = re.search(r"table\.header\(", body)
    if not h:
        raise SystemExit("FAIL parse: no table.header( found inside #table(")
    hdr_end = _match_bracket(body, h.end() - 1, "(", ")")
    after = body[hdr_end:]

    cells = split_cells(after)
    if len(cells) % 3 != 0:
        raise SystemExit(
            f"FAIL parse: {len(cells)} table cells after the header is not a "
            "multiple of 3 (expected Class / Reading / Pages per row)"
        )
    rows = []
    for i in range(0, len(cells), 3):
        cls, reading, pages = cells[i], cells[i + 1], cells[i + 2]
        pm = re.search(r"pp?\.\s*(\d+)\s*(?:--|–|-)\s*(\d+)", pages)
        rows.append(
            {
                "class": cls,
                "reading": reading,
                "pages_raw": pages,
                "start": int(pm.group(1)) if pm else None,
                "end": int(pm.group(2)) if pm else None,
            }
        )
    return rows


CAPTION_RE = re.compile(
    r"#align\(center\)\s*\[\s*#text\(13pt,\s*weight:\s*\"bold\"\)\s*\[",
    re.DOTALL,
)


def parse_captions(src: str) -> list[str]:
    """Titles from each per-reading caption block that follows a #pagebreak()."""
    titles = []
    for m in CAPTION_RE.finditer(src):
        open_at = m.end() - 1
        end = _match_bracket(src, open_at, "[", "]")
        titles.append(src[open_at + 1 : end - 1].strip())
    return titles


# ---------------------------------------------------------------- pdf reading


def pdf_page_count(pdf: Path) -> int:
    out = subprocess.run(
        ["pdfinfo", str(pdf)], capture_output=True, text=True, check=True
    ).stdout
    m = re.search(r"^Pages:\s+(\d+)", out, re.MULTILINE)
    if not m:
        raise SystemExit(f"FAIL parse: pdfinfo gave no page count for {pdf}")
    return int(m.group(1))


def pdf_page_texts(pdf: Path) -> list[str]:
    """1-indexed-by-shift list of per-page text. Index 0 == page 1."""
    if shutil.which("pdftotext"):
        n = pdf_page_count(pdf)
        pages = []
        for p in range(1, n + 1):
            r = subprocess.run(
                ["pdftotext", "-layout", "-f", str(p), "-l", str(p), str(pdf), "-"],
                capture_output=True,
                text=True,
                check=True,
            )
            pages.append(r.stdout)
        return pages
    try:
        from pypdf import PdfReader
    except ImportError:
        raise SystemExit(
            "FAIL setup: neither pdftotext nor pypdf is available to read the PDF"
        )
    return [pg.extract_text() or "" for pg in PdfReader(str(pdf)).pages]


# ---------------------------------------------------------------- normalising

MARKUP = re.compile(r"#[a-zA-Z]+|[\\_*\[\]]|\\u\{[0-9a-fA-F]+\}")


def norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.replace("—", "-").replace("–", "-").replace("−", "-")
    s = MARKUP.sub(" ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def find_start_page(title: str, pages: list[str], floor: int = 1) -> int | None:
    """First 1-based page >= floor whose text contains the normalised title.

    The floor is what keeps a caption from matching the summary table on page 1:
    reading titles are quoted there verbatim, so an unfloored search finds the
    table instead of the reading and computes a negative page range.
    """
    want = norm(title)
    if not want:
        return None
    normed = [norm(t) for t in pages[floor - 1 :]]
    for i, txt in enumerate(normed):
        if want in txt:
            return floor + i
    # Fall back to a distinctive prefix: a long caption can wrap in ways that
    # break the full string but leave the opening words intact.
    head = " ".join(want.split()[:6])
    if len(head.split()) >= 3:
        for i, txt in enumerate(normed):
            if head in txt:
                return floor + i
    return None


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("typ", type=Path)
    ap.add_argument("pdf", type=Path)
    ap.add_argument(
        "--target",
        help="one page target for every reading, e.g. 2-6. Omit to skip the length check.",
    )
    ap.add_argument(
        "--targets",
        type=Path,
        help="per-reading page targets: lines '<1-based reading index>\\t<MIN-MAX>'. "
        "Overrides --target for the readings it names; check.sh writes it from the plan.",
    )
    args = ap.parse_args()

    for p in (args.typ, args.pdf):
        if not p.is_file():
            print(f"FAIL setup: {p} does not exist")
            return 1

    tmin = tmax = None
    if args.target:
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", args.target.strip())
        if not m:
            print(f"FAIL setup: --target {args.target!r} is not MIN-MAX")
            return 1
        tmin, tmax = int(m.group(1)), int(m.group(2))

    per_reading: dict[int, tuple[int, int]] = {}
    if args.targets:
        if not args.targets.is_file():
            print(f"FAIL setup: --targets {args.targets} does not exist")
            return 1
        for lineno, line in enumerate(
            args.targets.read_text(encoding="utf-8").splitlines(), 1
        ):
            if not line.strip():
                continue
            m = re.fullmatch(r"\s*(\d+)\s*[\t]\s*(\d+)\s*-\s*(\d+)\s*", line)
            if not m:
                print(f"FAIL setup: --targets line {lineno} is not '<index>\\t<MIN-MAX>': {line!r}")
                return 1
            per_reading[int(m.group(1))] = (int(m.group(2)), int(m.group(3)))

    src = read_typ(args.typ)
    rows = parse_table_rows(src)
    captions = parse_captions(src)
    failures: list[str] = []

    # 1. arity
    if len(rows) != len(captions):
        print(
            f"FAIL arity: the summary table has {len(rows)} row(s) but the body "
            f"has {len(captions)} reading caption block(s). The table describes a "
            f"document that does not exist."
        )
        for i, r in enumerate(rows, 1):
            print(f"  table row {i}: {r['reading'][:78]}")
        for i, c in enumerate(captions, 1):
            print(f"  caption   {i}: {c[:78]}")
        return 1
    print(f"PASS arity: {len(rows)} table row(s) == {len(captions)} caption block(s)")

    if not captions:
        print("FAIL arity: no reading caption blocks found; nothing to verify")
        return 1

    # page ranges
    pages = pdf_page_texts(args.pdf)
    total = len(pages)
    starts: list[int] = []
    floor = 2  # page 1 is the cover + summary table, never a reading
    for idx, title in enumerate(captions, 1):
        p = find_start_page(title, pages, floor)
        if p is not None:
            floor = p + 1
        if p is None:
            failures.append(
                f"FAIL locate: caption {idx} ({title[:60]!r}) does not appear on "
                f"any page of {args.pdf.name}; its true start page is unknown"
            )
            starts.append(-1)
        else:
            starts.append(p)
    if any(s < 0 for s in starts):
        for f in failures:
            print(f)
        return 1

    ranges = []
    for i, s in enumerate(starts):
        e = (starts[i + 1] - 1) if i + 1 < len(starts) else total
        ranges.append((s, e))

    # 2. table truth
    ok_truth = True
    for i, (r, (s, e)) in enumerate(zip(rows, ranges), 1):
        if r["start"] is None:
            print(
                f"FAIL table: row {i} pages cell {r['pages_raw']!r} has no "
                f"'pp. A--B' range; true range is pp. {s}--{e}"
            )
            ok_truth = False
        elif (r["start"], r["end"]) != (s, e):
            print(
                f"FAIL table: row {i} states pp. {r['start']}--{r['end']} but "
                f"the compiled PDF puts this reading at pp. {s}--{e}"
            )
            ok_truth = False
    if ok_truth:
        print(f"PASS table: all {len(rows)} stated page range(s) match the PDF")

    # 3. length
    ok_len = True
    if tmin is not None or per_reading:
        n_measured = 0
        for i, ((s, e), c) in enumerate(zip(ranges, captions), 1):
            bounds = per_reading.get(i, (tmin, tmax) if tmin is not None else None)
            if bounds is None:
                continue
            lo, hi = bounds
            n_measured += 1
            n = e - s + 1
            if not (lo <= n <= hi):
                print(
                    f"FAIL length: reading {i} ({c[:50]!r}) is {n} page(s) at "
                    f"pp. {s}--{e}; target is {lo}-{hi}"
                )
                ok_len = False
        if ok_len:
            if per_reading:
                print(
                    f"PASS length: every one of {n_measured} reading(s) is within "
                    f"its own page target"
                )
            else:
                print(f"PASS length: every reading is within {tmin}-{tmax} pages")

    print()
    print("Computed table rows (paste these):")
    for r, (s, e) in zip(rows, ranges):
        print(f"  [{r['class']}],")
        print(f"  [{r['reading']}],")
        print(f"  [pp. {s}--{e}],")

    return 0 if (ok_truth and ok_len) else 1


if __name__ == "__main__":
    sys.exit(main())
