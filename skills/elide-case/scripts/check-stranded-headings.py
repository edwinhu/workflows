#!/usr/bin/env python3
"""Detect STRANDED HEADINGS in an addendum PDF: a caption block, section heading
or judge line at the foot of a page with its text beginning on the next.

This is the ONE page-boundary defect that is this skill's own. Widows, orphans
and runts are canonical and live in the typst plugin (`widows.py`, `orphans.py`,
`runts.py`); check.sh runs all three beside this one. Do not re-implement them
here — this script did once, and its detector needed justified body text, so on
three of the four real addenda (all ragged right) it REFUSED rather than
answered. The canonical checkers decide paragraph boundaries from the vertical
gap instead, which needs no justification premise, and they answer on all four.

A stranded heading needs no such premise either: the test is bold-and-short, not
flush-right. That is why this class stays, and why it kept running through the
old refusal — on the Tornetta addendum it was the one finding of four that was
genuine.

THE FIX VOCABULARY IS LAYOUT-ONLY. A stranded heading is fixed by adjusting
spacing or by moving where the page breaks — never by adding, cutting or
rewording the court's text. Rewording defeats the verbatim gate; if the two
conflict, fidelity wins and the defect stands.

Line extraction is pymupdf's text dict, deliberately not pdftotext, whose layout
reconstruction invents line breaks the renderer never made.

Usage:  check-stranded-headings.py <compiled.pdf> [--json]

Exit 0 = clean, 1 = stranded heading found, 2 = error.
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


def body_font_size(pages: list[list[dict]]) -> float:
    """The modal line height, which `is_heading` measures a line against."""
    sizes = [round(l["size"], 1) for pg in pages for l in pg]
    return max(set(sizes), key=sizes.count) if sizes else 12.0


def is_chrome(line: dict, page_height: float) -> bool:
    """Page numbers and running heads, which are not paragraph text."""
    if line["y0"] > page_height * 0.93:
        return True
    if line["y0"] < page_height * 0.04:
        return True
    return False


# ---------------------------------------------------------------- detection


def analyze(pdf_path: str) -> list[dict]:
    """Findings, one per page boundary that ends on a heading whose text is overleaf."""
    import pymupdf

    doc = pymupdf.open(pdf_path)
    pages: list[list[dict]] = []
    for page in doc:
        pages.append([l for l in extract_page_lines(page) if not is_chrome(l, page.rect.height)])
    body_size = body_font_size(pages)
    findings: list[dict] = []

    def is_heading(line: dict) -> bool:
        return line["size"] > body_size + 0.4 or (line["bold"] and len(line["text"]) < 90)

    for p in range(len(pages) - 1):
        cur, nxt = pages[p], pages[p + 1]
        if not cur or not nxt:
            continue
        last, first = cur[-1], nxt[0]
        if is_heading(last) and not is_heading(first):
            findings.append(
                {
                    "kind": "stranded-heading",
                    "page": p + 1,
                    "line": last["text"][:100],
                    "next": first["text"][:80],
                }
            )

    doc.close()
    return findings


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pdf")
    ap.add_argument("--json", action="store_true")
    ap.add_argument(
        "--which-python",
        action="store_true",
        help="print an interpreter that can import pymupdf, and exit. check.sh borrows "
        "this to run the canonical checkers, which do not re-exec to find one, and the "
        "test suite uses it to build fixtures with the same interpreter.",
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

    findings = analyze(args.pdf)
    name = os.path.basename(args.pdf)

    if args.json:
        print(json.dumps({"findings": findings}, indent=2))
    elif not findings:
        print(f"PASS stranded-headings: no heading stranded at a page foot in {name}")
    else:
        print(f"FAIL stranded-headings: {len(findings)} in {name}")
        for f in findings:
            print(f"  stranded-heading at the foot of page {f['page']}: \"{f['line']}\"")
            print(f"    adjoining: \"{f['next']}\"")
        print(
            "  FIX BY LAYOUT ONLY — spacing, or where the page breaks. Never by adding,\n"
            "  cutting or rewording the court's text: that would defeat the verbatim gate."
        )
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
