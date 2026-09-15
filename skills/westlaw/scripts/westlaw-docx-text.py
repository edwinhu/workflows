#!/usr/bin/env python3
"""Project a Westlaw XMLMIND_DOCX export to text, preserving the court's italics.

Westlaw uses a flat OPC layout: document.xml sits at the zip root, not under
word/, so python-docx and friends raise on open. Falls back to word/document.xml
so an ordinary docx also works.

The docx is the golden copy and the only stored source. This is the IN-MEMORY
projection its consumers read: `project()` is the entry point for them, and the CLI
is for eyeballing the same text they see. Nothing here is meant to be written beside
the docx — a persisted projection is a second copy that drifts, and the one that
existed dropped every italic run, which is how a 27-page casebook excerpt reached a
compiled reader with every case name in roman.
"""

import argparse
import re
import sys
import zipfile
from html import unescape

PARA_RE = re.compile(rb"<w:p[ >].*?</w:p>|<w:p/>", re.DOTALL)
TEXT_RE = re.compile(rb"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.DOTALL)
STAR_RE = re.compile(r"\*\d+")

RUN_RE = re.compile(rb"<w:r(?:\s[^>]*)?>(.*?)</w:r>", re.DOTALL)
RPR_RE = re.compile(rb"<w:rPr(?:\s[^>]*)?>(.*?)</w:rPr>", re.DOTALL)
# <w:i/>, <w:i w:val="true"/> turn italics ON; <w:i w:val="0"/> and w:val="false" turn
# them OFF, and a toggle property carrying an explicit off is common in exported runs.
ITALIC_RE = re.compile(rb"<w:i(\s[^>]*)?/?>")
ITALIC_OFF = re.compile(rb'w:val\s*=\s*"(0|false|off)"', re.IGNORECASE)


def read_document_xml(path):
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        for candidate, layout in (("document.xml", "flat OPC (zip root)"),
                                  ("word/document.xml", "standard OPC (word/)")):
            if candidate in names:
                return z.read(candidate), layout, len(names)
        raise SystemExit(
            f"{path}: no document.xml at zip root or under word/; parts: {sorted(names)}"
        )


def run_is_italic(run: bytes) -> bool:
    rpr = RPR_RE.search(run)
    if not rpr:
        return False
    m = ITALIC_RE.search(rpr.group(1))
    if not m:
        return False
    attrs = m.group(1) or b""
    return not ITALIC_OFF.search(attrs)


def para_text_with_emphasis(para: bytes) -> str:
    """Paragraph text with italic runs wrapped as Typst emphasis (`_..._`).

    The court's typography is part of the opinion: a case name set in roman that the
    reporter sets in italics is a typographic misquotation. Adjacent italic runs merge
    into one span, and the wrap sits inside the span's own whitespace so `_ foo _` —
    which Typst does not read as emphasis — cannot be produced.

    Returns "" when the run walk does not reproduce the flat `<w:t>` text, so a
    paragraph whose markup this function does not model falls back to the flat read
    rather than silently losing words.
    """
    spans: list[tuple[bool, str]] = []
    for run in RUN_RE.findall(para):
        text = "".join(unescape(t.decode("utf-8")) for t in TEXT_RE.findall(run))
        if not text:
            continue
        ital = run_is_italic(run)
        if spans and spans[-1][0] == ital:
            spans[-1] = (ital, spans[-1][1] + text)
        else:
            spans.append((ital, text))
    if "".join(s for _, s in spans) != "".join(
        unescape(t.decode("utf-8")) for t in TEXT_RE.findall(para)
    ):
        return ""
    out = []
    for ital, text in spans:
        if not ital or not text.strip():
            out.append(text)
            continue
        lead = text[: len(text) - len(text.lstrip())]
        trail = text[len(text.rstrip()):]
        out.append(f"{lead}_{text.strip()}_{trail}")
    return "".join(out)


def paragraphs(xml, emphasis: bool = True):
    out = []
    for para in PARA_RE.findall(xml):
        text = para_text_with_emphasis(para) if emphasis else ""
        if not text:
            text = "".join(unescape(t.decode("utf-8")) for t in TEXT_RE.findall(para))
        text = text.strip()
        if text:
            out.append(text)
    return out


def project(path, emphasis: bool = True) -> str:
    """The in-memory projection of a docx. Consumers import THIS, not the CLI.

    Emphasis is on by default on both paths: the projection is what an excerpt is cut
    from, and the court's typography is part of the opinion. `--no-emphasis` reproduces
    a pre-italics extraction for diffing and nothing else.
    """
    xml, _layout, _nparts = read_document_xml(path)
    return "\n\n".join(paragraphs(xml, emphasis=emphasis)) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("docx")
    ap.add_argument("-o", "--output", help="write text here (default: stdout)")
    # Emphasis is ON by default because the projection is what a consumer reads and
    # the court's italics are part of the opinion. --no-emphasis is for diffing
    # against a pre-italics extraction, not for producing a source anything cuts from.
    ap.add_argument("--emphasis", action="store_true", default=True,
                    help="wrap italic runs as Typst emphasis (`_..._`) — the default")
    ap.add_argument("--no-emphasis", dest="emphasis", action="store_false",
                    help="flat text, italics discarded; for diffing only")
    args = ap.parse_args()

    xml, layout, npart = read_document_xml(args.docx)
    paras = paragraphs(xml, emphasis=args.emphasis)
    body = "\n\n".join(paras) + "\n"

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(body)
    else:
        sys.stdout.write(body)

    stars = STAR_RE.findall(body)
    print(f"layout: {layout} ({npart} parts)", file=sys.stderr)
    print(f"paragraphs: {len(paras)}", file=sys.stderr)
    print(f"characters: {len(body)}", file=sys.stderr)
    if args.emphasis:
        print(f"emphasis spans: {body.count('_') // 2}", file=sys.stderr)
    print(f"star-page markers: {len(stars)}", file=sys.stderr)
    if stars:
        print(f"first markers: {' '.join(stars[:8])}", file=sys.stderr)


if __name__ == "__main__":
    main()
