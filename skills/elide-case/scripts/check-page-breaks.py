#!/usr/bin/env python3
"""Page-level widow/orphan and stranded-heading detection for an addendum PDF.

check-quotes.py proves the WORDS match the reporter. It says nothing about how
Typst SET them, and a verbatim-perfect excerpt can still break badly across a
page. This script decides three page-boundary defects:

  orphan            a paragraph's FIRST line alone at the foot of a page, the
                    rest of the paragraph overleaf
  widow             a paragraph's LAST line alone at the top of a page
  stranded-heading  a caption block, section heading or judge line at the foot
                    of a page with its text beginning on the next

THE FIX VOCABULARY IS LAYOUT-ONLY. A widow is fixed by adjusting spacing or by
moving where the page breaks — never by adding, cutting or rewording the court's
text. Rewording to fix a widow defeats the verbatim gate; if the two conflict,
fidelity wins and the widow stands.

Widow and orphan detection rests on justified body text: in a justified
paragraph every line but the last is flush to the right margin, so "this line
continues" is a measurement (x1 at the margin) rather than a guess about
sentences. That premise is now CHECKED, not assumed. body_metrics() measures the
flush-right fraction; below --min-flush-frac (default 0.60) the two classes are
REFUSED and reported as unjudgeable rather than guessed at. The stranded-heading
check uses bold-and-short, not the margin, so it runs through the refusal.

Runts — one word alone on a paragraph's LAST line — are a different class with a
different cause and a different fix, and ragged-right prose is exactly where they
live. They are NOT detected here; scripts/check-widows.py --prose owns them, and
check.sh runs it as its own sub-check so it keeps running when this refusal fires.

Line extraction is pymupdf's text dict, the same approach as
/home/eh/projects/teaching/scripts/check-widows.py — deliberately not pdftotext,
whose layout reconstruction invents line breaks the renderer never made. That
script is SLIDE-specific (bullet wraps, Touying footers, animation dedup) and
shares nothing with page-boundary analysis beyond those few lines, so the
extraction is reproduced here rather than imported.

Usage:  check-page-breaks.py <compiled.pdf> [--json]

Exit 0 = clean, 1 = defects found, 2 = error, 3 = widow/orphan REFUSED (input is
not justified) and nothing else found. 3 is deliberately not 0: a non-answer must
never read as a pass.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

# ---------------------------------------------------------------- interpreter
# pymupdf is an existing course dependency (secreg's pixi env, and what
# check-widows.py already uses); it is not added here. The ambient python3 may
# not be the one that has it, so re-exec into one that does rather than failing
# on an environment detail. Never silently skip: no interpreter is exit 2, which
# check.sh reads as a FAIL.


def _has_pymupdf(exe: str) -> bool:
    import subprocess

    try:
        return (
            subprocess.run(
                [exe, "-c", "import pymupdf"], capture_output=True, timeout=60
            ).returncode
            == 0
        )
    except Exception:
        return False


def _candidates(pdf_path: str) -> list[str]:
    out: list[str] = []
    env = os.environ.get("ELIDE_PYTHON")
    if env:
        out.append(env)
    # Walk up from the PDF: a course tree keeps its interpreter in .pixi/envs/.
    d = os.path.dirname(os.path.abspath(pdf_path))
    while True:
        out.extend(sorted(glob.glob(os.path.join(d, ".pixi", "envs", "*", "bin", "python"))))
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    home = os.path.expanduser("~")
    for pat in ("*/.pixi/envs/*/bin/python", "*/*/.pixi/envs/*/bin/python"):
        out.extend(sorted(glob.glob(os.path.join(home, pat))))
    return out


def _ensure_pymupdf(pdf_path: str) -> None:
    try:
        import pymupdf  # noqa: F401

        return
    except ImportError:
        pass
    if os.environ.get("ELIDE_PAGEBREAKS_REEXEC"):
        print(
            "FAIL setup: pymupdf is not importable from the re-exec interpreter "
            f"{sys.executable}",
            file=sys.stderr,
        )
        sys.exit(2)
    for exe in _candidates(pdf_path):
        if os.path.exists(exe) and _has_pymupdf(exe):
            os.environ["ELIDE_PAGEBREAKS_REEXEC"] = "1"
            print(f"note: re-exec into {exe} for pymupdf", file=sys.stderr)
            os.execv(exe, [exe, os.path.abspath(__file__)] + sys.argv[1:])
    print(
        "FAIL setup: pymupdf is required and no interpreter providing it was found.\n"
        "  Set ELIDE_PYTHON to a python that can 'import pymupdf'.\n"
        "  This is a FAIL, not a skip: a page-break check that did not run must "
        "never read as clean.",
        file=sys.stderr,
    )
    sys.exit(2)


# ---------------------------------------------------------------- extraction


def extract_page_lines(page) -> list[dict]:
    """Lines of one page, top-to-bottom, from pymupdf's text dict."""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            text = "".join(span["text"] for span in line["spans"])
            if not text.strip():
                continue
            sizes = [s["size"] for s in line["spans"] if s["text"].strip()]
            flags = [s["flags"] for s in line["spans"] if s["text"].strip()]
            lines.append(
                {
                    "text": text.strip(),
                    "bbox": line["bbox"],
                    "x0": line["bbox"][0],
                    "y0": line["bbox"][1],
                    "x1": line["bbox"][2],
                    "size": max(sizes) if sizes else 0.0,
                    # bit 4 (16) is pymupdf's bold flag
                    "bold": any(f & 16 for f in flags),
                }
            )
    lines.sort(key=lambda l: (round(l["y0"], 1), l["x0"]))
    return lines


# ---------------------------------------------------------------- geometry


def body_metrics(
    pages: list[list[dict]], right_tol: float = 3.0
) -> tuple[float, float, float, float]:
    """(right margin, body font size, modal leading, flush-right fraction).

    The flush-right fraction is what makes the docstring's premise CHECKABLE
    instead of assumed. In justified prose ~90% of lines end within a point of
    the modal right edge; measured on a ragged-right addendum it was 23.6%, and
    at that value `continues()` reads a merely-short line as "paragraph ended
    here" — which is how a two-line carryover becomes a reported widow.
    """
    # The right margin is the MODAL line end, not the maximum. In justified body
    # text most lines end exactly at the margin, while a table rule, a centered
    # header or a glyph overhang can reach past it — and a right margin set too
    # far right makes `continues()` false everywhere, which is a vacuous pass.
    x1s = [round(l["x1"]) for pg in pages for l in pg]
    sizes = [round(l["size"], 1) for pg in pages for l in pg]
    gaps: list[float] = []
    for pg in pages:
        for a, b in zip(pg, pg[1:]):
            g = b["y0"] - a["y0"]
            if 0 < g < 60:
                gaps.append(round(g, 1))
    right = float(max(set(x1s), key=x1s.count)) if x1s else 0.0
    body = max(set(sizes), key=sizes.count) if sizes else 12.0
    lead = max(set(gaps), key=gaps.count) if gaps else 14.0
    flush = (
        sum(1 for v in x1s if v >= right - right_tol) / len(x1s) if x1s else 0.0
    )
    return right, body, lead, flush


def is_chrome(line: dict, page_height: float) -> bool:
    """Page numbers and running heads, which are not paragraph text."""
    if line["y0"] > page_height * 0.93:
        return True
    if line["y0"] < page_height * 0.04:
        return True
    return False


# ---------------------------------------------------------------- detection


def analyze(
    pdf_path: str,
    right_tol: float = 3.0,
    gap_slack: float = 1.4,
    min_flush_frac: float = 0.60,
) -> tuple[list[dict], dict]:
    """(findings, geometry).

    Below min_flush_frac the widow/orphan verdicts are REFUSED rather than
    rendered: their whole basis is `continues()`, which is only a measurement in
    justified text. The stranded-heading check is geometry-independent (bold and
    short, not flush-right) and keeps running through the refusal — on a real
    addendum it was the one finding of four that was genuine.
    """
    import pymupdf

    doc = pymupdf.open(pdf_path)
    pages: list[list[dict]] = []
    heights: list[float] = []
    for page in doc:
        heights.append(page.rect.height)
        pages.append([l for l in extract_page_lines(page) if not is_chrome(l, page.rect.height)])
    right, body_size, lead, flush_frac = body_metrics(pages, right_tol)
    judged = flush_frac >= min_flush_frac
    geometry = {
        "flush_frac": round(flush_frac, 4),
        "min_flush_frac": min_flush_frac,
        "right_margin": right,
        "widow_orphan_judged": judged,
    }
    findings: list[dict] = []

    def continues(line: dict) -> bool:
        """A justified line flush to the right margin has more paragraph after it."""
        return line["x1"] >= right - right_tol

    def starts_paragraph(pg: list[dict], i: int) -> bool:
        if i == 0:
            return True
        prev = pg[i - 1]
        if not continues(prev):
            return True  # previous line was ragged: it ended its paragraph
        if pg[i]["y0"] - prev["y0"] > lead * gap_slack:
            return True  # a visible block gap
        return False

    def is_heading(line: dict) -> bool:
        return line["size"] > body_size + 0.4 or (line["bold"] and len(line["text"]) < 90)

    for p in range(len(pages) - 1):
        cur, nxt = pages[p], pages[p + 1]
        if not cur or not nxt:
            continue
        last = cur[-1]
        first = nxt[0]

        # stranded heading / caption: the page ends on a heading-ish line whose
        # text begins overleaf.
        if is_heading(last) and not is_heading(first):
            findings.append(
                {
                    "kind": "stranded-heading",
                    "page": p + 1,
                    "line": last["text"][:100],
                    "next": first["text"][:80],
                }
            )
            continue

        if not judged:
            continue  # refusal: widow/orphan rest on continues(), which is unusable here

        if not continues(last):
            continue  # the paragraph ended on this page; no split to judge

        # orphan: the last line of the page is the FIRST line of its paragraph.
        if starts_paragraph(cur, len(cur) - 1):
            findings.append(
                {
                    "kind": "orphan",
                    "page": p + 1,
                    "line": last["text"][:100],
                    "next": first["text"][:80],
                }
            )

        # widow: only ONE line of the continued paragraph landed on the next
        # page — either it is the whole page's content, or the line after it
        # starts a new paragraph.
        if len(nxt) == 1 or (len(nxt) > 1 and not continues(first)) or (
            len(nxt) > 1 and nxt[1]["y0"] - first["y0"] > lead * gap_slack
        ):
            findings.append(
                {
                    "kind": "widow",
                    "page": p + 2,
                    "line": first["text"][:100],
                    "next": last["text"][:80],
                }
            )

    doc.close()
    return findings, geometry


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--min-flush-frac",
        type=float,
        default=0.60,
        help="Fraction of lines that must be flush to the modal right margin before "
        "widow/orphan verdicts are rendered at all (default 0.60). Below it the "
        "checker REFUSES those two classes and reports that it cannot judge.",
    )
    ap.add_argument(
        "--which-python",
        action="store_true",
        help="print an interpreter that can import pymupdf, and exit. The test suite "
        "uses it to build fixtures with the same interpreter this checker will use.",
    )
    args = ap.parse_args()

    if args.which_python:
        try:
            import pymupdf  # noqa: F401

            print(sys.executable)
            return 0
        except ImportError:
            pass
        for exe in _candidates(args.pdf):
            if os.path.exists(exe) and _has_pymupdf(exe):
                print(exe)
                return 0
        return 2

    if not os.path.isfile(args.pdf):
        print(f"FAIL setup: no such PDF: {args.pdf}")
        return 2
    _ensure_pymupdf(args.pdf)

    findings, geo = analyze(args.pdf, min_flush_frac=args.min_flush_frac)
    judged = geo["widow_orphan_judged"]
    pct = f"{geo['flush_frac'] * 100:.1f}%"
    floor = f"{geo['min_flush_frac'] * 100:.0f}%"
    refusal = (
        f"REFUSED widow/orphan: only {pct} of lines are flush to the right margin "
        f"(floor {floor}), so this document is NOT justified and widow/orphan "
        f"detection is not applicable. This is a NON-ANSWER, not a clean bill: "
        f"nobody judged widows or orphans here. Stranded headings were still checked."
    )

    if args.json:
        print(json.dumps({"findings": findings, "geometry": geo}, indent=2))
    elif not findings:
        if judged:
            print(
                "PASS page-breaks: no widow, orphan or stranded heading in "
                f"{os.path.basename(args.pdf)}"
            )
        else:
            print(refusal)
            print(
                "  no stranded heading in " f"{os.path.basename(args.pdf)}"
            )
    else:
        if not judged:
            print(refusal)
        print(
            f"FAIL page-breaks: {len(findings)} defect(s) in {os.path.basename(args.pdf)}"
        )
        for f in findings:
            where = "at the foot of page" if f["kind"] != "widow" else "at the top of page"
            print(f"  {f['kind']} {where} {f['page']}: \"{f['line']}\"")
            print(f"    adjoining: \"{f['next']}\"")
        print(
            "  FIX BY LAYOUT ONLY — spacing, or where the page breaks. Never by adding,\n"
            "  cutting or rewording the court's text: that would defeat the verbatim gate."
        )
    # 3 = refused, nothing else wrong. Distinct from 0 so no caller can read a
    # non-answer as a clean bill; distinct from 1 so a refusal is not a defect.
    if findings:
        return 1
    return 0 if judged else 3


if __name__ == "__main__":
    sys.exit(main())
