#!/usr/bin/env python3
"""Remove manual spacer paragraphs from a .docx body; let the styles do spacing.

WHY THIS IS A PRODUCTION-CHAIN STEP

Manuscripts often build their heading rhythm on a convention of one empty
paragraph before every heading, stacked on top of the spacing the styles
already define.  Hand-maintained whitespace drifts.  A real audit of a law
review submission found one heading with a doubled blank and two with none,
reading as +/-15pt against a 38pt norm -- invisible in the .docx, obvious only
in the rendered PDF.

Deleting the spacers removes the entire class of defect.  Run it before
rendering so the layout comes from the stylesheet alone.

WHAT IT REFUSES TO TOUCH

A paragraph with no text is not necessarily empty.  In one real manuscript
four of sixty-nine text-empty paragraphs carried real content:

    * one held the `w:drawing` for the article's only figure -- deleting that
      paragraph deletes the figure
    * two held `bookmarkStart` anchors that the TOC and cross-references target
    * one held a `w:br`

So a paragraph is removed only when it has no text, no `pStyle`, and none of
the structural children listed in KEEP.  Anything else is reported and kept.
A blanket "strip every empty paragraph" would silently drop the figure.

Only direct children of `w:body` are considered; paragraphs inside tables,
headers, footers and footnotes are left alone.

USAGE
    python docx_spacers.py FILE.docx [--in-place] [--check]
"""

from __future__ import annotations

import argparse
import re
import shutil
import zipfile
from pathlib import Path

PART = "word/document.xml"

# Structural children that make a text-empty paragraph load-bearing.
KEEP = (
    "drawing", "pict", "object", "br", "fldChar", "instrText",
    "bookmarkStart", "bookmarkEnd", "footnoteReference", "endnoteReference",
    "commentRangeStart", "commentRangeEnd", "commentReference", "sectPr",
    "hyperlink", "tbl",
)

PARA_RE = re.compile(rb"<w:p\b(?:[^>]*?/>|.*?</w:p>)", re.DOTALL)
TEXT_RE = re.compile(rb"<w:t\b[^>]*>(.*?)</w:t>", re.DOTALL)
STYLE_RE = re.compile(rb"<w:pStyle\b")
BODY_RE = re.compile(rb"<w:body\b[^>]*>(.*)</w:body>", re.DOTALL)

# Containers whose paragraphs are NOT direct body children: table cells, text
# boxes, and content controls (the TOC lives in a w:sdt).  Paragraphs inside
# them belong to a structure with its own layout rules and must be left alone.
NESTED = ("tbl", "txbxContent", "sdt")
NEST_RE = re.compile(
    rb"<(/?)(?:w:)?(" + b"|".join(n.encode() for n in NESTED) + rb")\b([^>]*?)(/?)>"
)


def top_level_paragraphs(raw: bytes):
    """(start, end) of every w:p that is a direct child of w:body.

    Textual rather than a tree rewrite: ElementTree re-emits only the
    namespaces it sees in use, silently dropping the two dozen w14/w15/w16*
    declarations this file carries and leaving mc:Ignorable pointing at
    undeclared prefixes -- invalid OOXML that Word rejects.
    """
    m = BODY_RE.search(raw)
    if not m:
        raise SystemExit("no <w:body> found")
    lo, hi = m.start(1), m.end(1)

    # byte ranges covered by a nested container, at any depth
    excluded, depth, start = [], 0, None
    for n in NEST_RE.finditer(raw, lo, hi):
        closing, _name, _attrs, selfclose = n.group(1), n.group(2), n.group(3), n.group(4)
        if selfclose:
            continue
        if not closing:
            if depth == 0:
                start = n.start()
            depth += 1
        else:
            depth -= 1
            if depth == 0 and start is not None:
                excluded.append((start, n.end()))
                start = None
    if depth:
        raise SystemExit("unbalanced nested container in w:body")

    def nested(pos):
        return any(a <= pos < b for a, b in excluded)

    spans = [(p.start(), p.end()) for p in PARA_RE.finditer(raw, lo, hi)
             if not nested(p.start())]
    return spans


def classify(block: bytes):
    """-> (removable, reason_kept)"""
    if re.sub(rb"\s+", b"", b"".join(TEXT_RE.findall(block))):
        return False, "has text"
    if STYLE_RE.search(block):
        return False, "has pStyle"
    found = [k for k in KEEP if re.search(rb"<w:%s\b" % k.encode(), block)]
    if found:
        return False, "+".join(found)
    return True, None


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("docx")
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="report spacers and exit 1 if any remain; change nothing")
    args = ap.parse_args()

    src = Path(args.docx)
    raw = zipfile.ZipFile(src).read(PART)
    spans = top_level_paragraphs(raw)

    doomed, kept = [], []
    for start, end in spans:
        block = raw[start:end]
        ok, why = classify(block)
        if ok:
            doomed.append((start, end))
        elif why != "has text":
            kept.append(why)

    print(f"{src.name}: {len(spans)} body paragraphs, {len(doomed)} spacer(s) to remove")
    if kept:
        from collections import Counter
        for why, n in sorted(Counter(kept).items()):
            print(f"  kept {n} text-empty paragraph(s): {why}")

    if args.check:
        return 1 if doomed else 0
    if not doomed:
        print("nothing to remove")
        return 0

    for start, end in reversed(doomed):   # back to front: offsets stay valid
        raw = raw[:start] + raw[end:]

    dest = src if args.in_place else src.with_name(src.stem + " (spacers stripped).docx")
    tmp = str(dest) + ".tmp"
    zin = zipfile.ZipFile(src)
    zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        zout.writestr(item, raw if item.filename == PART else zin.read(item.filename))
    zout.close()
    zin.close()
    shutil.move(tmp, dest)
    print(f"removed {len(doomed)} paragraph(s) -> {dest.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
