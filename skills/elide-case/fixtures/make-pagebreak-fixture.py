#!/usr/bin/env python3
"""Build page-break fixture PDFs with exact, known line geometry.

The unit under test (scripts/check-page-breaks.py) consumes a PDF, so the
fixture is a PDF. Drawing the lines directly is what makes the defect KNOWN:
compiling Typst prose and hoping a widow falls out gives a fixture whose defect
nobody can state, and Typst 0.15's own layout suppressed every attempt, so a
"clean" result there proves nothing about the checker.

The signal the checker reads is justification: a line that continues its
paragraph ends flush at the right margin, a paragraph's last line ends short.
`full` lines are therefore padded with words until they reach the margin.

Usage: make-pagebreak-fixture.py <kind> <out.pdf>
       kind = clean | orphan | widow | stranded-heading
              | ragged | ragged-heading | runt-repeat

The last three are RAGGED-RIGHT on purpose. `ragged` and `ragged-heading` sit far
below the flush-right floor, so check-page-breaks.py must refuse widow/orphan on
them rather than emit verdicts; `ragged-heading` also carries a real stranded
heading, which the refusal must not suppress. `runt-repeat` ends paragraphs on the
SAME single word on two different pages, which a document-global dedup swallows.
"""

from __future__ import annotations

import sys

import pymupdf

W, H = 612.0, 792.0
LEFT, RIGHT = 72.0, 540.0
TOP = 90.0
LEAD = 16.0
SIZE = 12.0
FONT = "helv"
PAD = "and the court further observed that the record so reflected in every respect"


def _width(s: str) -> float:
    return pymupdf.get_text_length(s, fontsize=SIZE, fontname=FONT)


def full_text(seed: str) -> str:
    """`seed` padded with words until the line ends within 1pt of the margin."""
    measure = RIGHT - LEFT
    words = PAD.split()
    s, i = seed, 0
    while _width(s) < measure - 1.0:
        s = f"{s} {words[i % len(words)]}"
        i += 1
    while _width(s) > measure:
        s = s[:-1]
    return s


def render(page, specs: list[tuple[str, str]]) -> None:
    """Draw one page. spec kinds: full, short, head; 'gap' inserts a blank."""
    y = TOP
    for kind, text in specs:
        if kind == "gap":
            y += LEAD * 0.8
            continue
        if kind == "full":
            page.insert_text((LEFT, y), full_text(text), fontsize=SIZE, fontname=FONT)
        elif kind == "short":
            page.insert_text((LEFT, y), text, fontsize=SIZE, fontname=FONT)
        elif kind == "head":
            page.insert_text((LEFT, y), text, fontsize=13.5, fontname="hebo")
        y += LEAD


def paragraph(tag: str, n_full: int) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = [
        ("full", f"{tag} line {i} of the opinion text") for i in range(n_full)
    ]
    out.append(("short", f"{tag} last line."))
    out.append(("gap", ""))
    return out


def main() -> int:
    kind, out = sys.argv[1], sys.argv[2]
    doc = pymupdf.open()
    doc.new_page(width=W, height=H)
    doc.new_page(width=W, height=H)
    # Re-fetch AFTER both pages exist: adding a page invalidates page handles
    # taken before it, and drawing through a stale one raises on .parent.
    p1, p2 = doc[0], doc[1]

    if kind == "clean":
        # Every paragraph both starts and ends on one page.
        render(p1, paragraph("A", 4) + paragraph("B", 4) + paragraph("C", 3))
        render(p2, paragraph("D", 4) + paragraph("E", 3))

    elif kind == "orphan":
        # Page 1 ends on the FIRST line of a paragraph continued overleaf.
        render(p1, paragraph("A", 4) + paragraph("B", 4) + [("full", "ORPHANED first line")])
        render(
            p2,
            [("full", f"remainder line {i}") for i in range(4)]
            + [("short", "and its last line."), ("gap", "")]
            + paragraph("C", 4),
        )

    elif kind == "widow":
        # Exactly ONE line of the split paragraph lands on page 2, and it is
        # that paragraph's LAST line.
        render(
            p1,
            paragraph("A", 4)
            + paragraph("B", 4)
            + [("full", f"split paragraph line {i}") for i in range(4)],
        )
        render(p2, [("short", "WIDOWED last line."), ("gap", "")] + paragraph("C", 4))

    elif kind == "stranded-heading":
        render(p1, paragraph("A", 4) + paragraph("B", 4) + [("head", "II. THE EFFORTS-OF-OTHERS PRONG")])
        render(p2, paragraph("C", 4) + paragraph("D", 3))

    elif kind in ("ragged", "ragged-heading", "runt-repeat"):
        # No line reaches the margin: a ragged-right document, like an addendum
        # compiled with Typst's default justify: false.
        def rag(tag: str, n: int, tail: str) -> list[tuple[str, str]]:
            out: list[tuple[str, str]] = [
                (
                    "short",
                    # Each line a different length, so no single x1 dominates:
                    # a ragged right edge is what makes continues() meaningless.
                    (
                        f"{tag} line {i} of the opinion text as the court set it "
                        f"out at some length in the record below "
                        + " ".join(PAD.split()[: 1 + (i * 3) % 9])
                    ),
                )
                for i in range(n)
            ]
            out.append(("short", tail))
            out.append(("gap", ""))
            return out

        if kind == "runt-repeat":
            render(p1, rag("A", 4, "process.") + rag("B", 4, "elsewhere."))
            render(p2, rag("C", 4, "process.") + rag("D", 3, "final."))
        elif kind == "ragged-heading":
            render(p1, rag("A", 4, "and so it held.") + [("head", "II. THE SECOND PRONG")])
            render(p2, rag("C", 4, "and so it held.") + rag("D", 3, "and so it held."))
        else:
            render(p1, rag("A", 4, "and so it held.") + rag("B", 4, "and so it held."))
            render(p2, rag("C", 4, "and so it held.") + rag("D", 3, "and so it held."))

    else:
        print(f"unknown fixture kind: {kind}", file=sys.stderr)
        return 2

    doc.save(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
