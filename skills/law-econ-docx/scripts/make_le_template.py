#!/usr/bin/env -S uv run python3
"""Generate the Law & Economics pandoc reference document.

    uv run python3 make_le_template.py [-o OUT.docx]

The template is BUILT, not hand-edited, so it stays reproducible and every
typographic choice is auditable in one place. Regenerate after changing
anything here; never edit the .docx by hand in Word.

Provenance of the design
------------------------
* **Skeleton** = ``pandoc --print-default-data-file reference.docx``. Starting
  from pandoc's own reference doc guarantees every part/style pandoc's docx
  writer looks for is present with the exact styleIds it emits.
* **Typography** = WordTeX (https://tomwildenhain.com/wordtex/). WordTeX's
  ``WordTeX Template.dotx`` turns out to be a pandoc-shaped style set already
  (Compact / Author / Abstract / BlockText / FootnoteText / TableCaption /
  CaptionedFigure / SourceCode / VerbatimChar are all pandoc styleIds), so the
  Latin Modern theme fonts, the Latin Modern Math ``m:mathFont``, and the
  heading/caption proportions transplant cleanly. We deliberately do NOT ship
  the .dot itself: it is an authoring add-in (VSTO plugin, glossary/AutoText,
  autocorrect macros) and pandoc needs a plain .docx that merely CARRIES style
  definitions.
* **Editorial rules** = the Journal of Law and Economics author instructions
  and the Chicago EMS guide. See ``references/jle-house-style.md``.

Where JLE overrides WordTeX, JLE wins and the divergence is commented inline.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# --- typography knobs -------------------------------------------------------
# "LM Roman 10" is the WordTeX/TeX Gyre family name for the 10pt optical size;
# "Latin Modern Roman" is the same face's canonical family name and is what
# fontconfig (Linux) and most installs expose. Both are listed so Word (which
# sees "LM Roman 10" after the WordTeX font install) and LibreOffice/x2t
# (which resolve "Latin Modern Roman") each find the face.
SERIF = "Latin Modern Roman"
SERIF_ALT = "LM Roman 10"
MONO = "Latin Modern Mono"
MATH = "Latin Modern Math"

BODY_HALF_PT = 24          # 12pt — JLE manuscript body size
DOUBLE = 480               # w:line for double spacing at lineRule="auto"


def _p(*children: str) -> str:
    return "".join(children)


def _style(sid: str, name: str, *, based: str | None = None, nxt: str | None = None,
           ppr: str = "", rpr: str = "", typ: str = "paragraph",
           custom: bool = False, link: str | None = None, qformat: bool = True) -> str:
    parts = [f'<w:name w:val="{name}"/>']
    if based:
        parts.append(f'<w:basedOn w:val="{based}"/>')
    if nxt:
        parts.append(f'<w:next w:val="{nxt}"/>')
    if link:
        parts.append(f'<w:link w:val="{link}"/>')
    if qformat:
        parts.append("<w:qFormat/>")
    if ppr:
        parts.append(f"<w:pPr>{ppr}</w:pPr>")
    if rpr:
        parts.append(f"<w:rPr>{rpr}</w:rPr>")
    cust = ' w:customStyle="1"' if custom else ""
    return (f'<w:style w:type="{typ}"{cust} w:styleId="{sid}">' + "".join(parts) + "</w:style>")


def _spacing(before: int = 0, after: int = 0, line: int = DOUBLE) -> str:
    return f'<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>'


# Every paragraph style below is double spaced. JLE: "Manuscripts submitted for
# publication should be double spaced throughout (including footnotes, tables,
# and figure legends)." That is the single biggest divergence from WordTeX,
# which is tuned to LaTeX's tight 1.0 leading (w:line="204").
STYLE_DEFS: dict[str, str] = {
    "Normal": _style(
        "Normal", "Normal",
        # Flush left, not justified: Chicago's manuscript-prep guidance is
        # "keep it simple"; justified + double spaced opens rivers and the
        # copyeditor strips it anyway. WordTeX justifies (jc=both) because it
        # is imitating a typeset LaTeX page, not a manuscript.
        ppr=_p("<w:widowControl/>", _spacing(), '<w:jc w:val="left"/>'),
        rpr=_p(f'<w:rFonts w:ascii="{SERIF}" w:hAnsi="{SERIF}" w:cs="{SERIF}"/>',
               f'<w:sz w:val="{BODY_HALF_PT}"/><w:szCs w:val="{BODY_HALF_PT}"/>'),
    ),
    # pandoc puts the first paragraph after a heading in FirstParagraph (no
    # indent) and the rest in BodyText (indented) — the LaTeX convention.
    "BodyText": _style("BodyText", "Body Text", based="Normal",
                       ppr=_p(_spacing(), '<w:ind w:firstLine="720"/>')),
    "FirstParagraph": _style("FirstParagraph", "First Paragraph", based="BodyText",
                             ppr=_p(_spacing(), '<w:ind w:firstLine="0"/>')),
    "Compact": _style("Compact", "Compact", based="BodyText",
                      ppr=_p(_spacing(), '<w:ind w:firstLine="0"/>')),

    # --- title page ---------------------------------------------------------
    "Title": _style("Title", "Title", based="Normal", nxt="Author",
                    ppr=_p("<w:keepNext/><w:keepLines/>",
                           _spacing(before=0, after=240), '<w:jc w:val="center"/>'),
                    rpr='<w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/>'),
    "Subtitle": _style("Subtitle", "Subtitle", based="Normal", nxt="Author",
                       ppr=_p("<w:keepNext/>", _spacing(after=120), '<w:jc w:val="center"/>'),
                       rpr='<w:i/><w:iCs/><w:sz w:val="26"/><w:szCs w:val="26"/>'),
    # JLE: the title page carries "the names, e-mail addresses, and affiliations
    # of all authors". Put all three in the YAML `author` entries; they land here.
    "Author": _style("Author", "Author", based="Normal", nxt="Date",
                     ppr=_p("<w:keepNext/>", _spacing(before=120, after=0),
                            '<w:contextualSpacing/><w:jc w:val="center"/>')),
    "Date": _style("Date", "Date", based="Normal", nxt="AbstractTitle",
                   ppr=_p("<w:keepNext/>", _spacing(before=120, after=240),
                          '<w:jc w:val="center"/>')),
    "AbstractTitle": _style("AbstractTitle", "Abstract Title", based="Normal", nxt="Abstract",
                            ppr=_p("<w:keepNext/><w:keepLines/>",
                                   _spacing(before=240, after=0), '<w:jc w:val="center"/>'),
                            rpr="<w:b/><w:bCs/>"),
    # WordTeX shrinks the abstract to 10pt and indents both margins. The size
    # reduction violates "double spaced throughout" at 12pt, so only the
    # left/right indent survives.
    "Abstract": _style("Abstract", "Abstract", based="Normal",
                       ppr=_p(_spacing(before=0, after=240),
                              '<w:ind w:left="720" w:right="720" w:firstLine="0"/>')),

    # --- headings -----------------------------------------------------------
    # JLE subhead ladder, verbatim from the author instructions:
    #   1.     Arabic Numbers, Boldface Font, Cap and Lower Case
    #   1.1.   Arabic Numbers, Italic Font, Cap and Lower Case
    #   1.1.1. Arabic Numbers, Cap and Lower Case          (roman, no emphasis)
    #   Run-in Text, Italic Font, Cap and Lower Case.
    # Numbers come from numbering.xml (numId 900) so Word renumbers on edit —
    # authors must NOT type "1." into the markdown heading.
    "Heading1": _style("Heading1", "heading 1", based="Normal", nxt="FirstParagraph",
                       link="Heading1Char",
                       ppr=_p("<w:keepNext/><w:keepLines/>",
                              '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="900"/></w:numPr>',
                              _spacing(before=360, after=0),
                              '<w:outlineLvl w:val="0"/>'),
                       rpr="<w:b/><w:bCs/>"),
    "Heading2": _style("Heading2", "heading 2", based="Normal", nxt="FirstParagraph",
                       link="Heading2Char",
                       ppr=_p("<w:keepNext/><w:keepLines/>",
                              '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="900"/></w:numPr>',
                              _spacing(before=240, after=0),
                              '<w:outlineLvl w:val="1"/>'),
                       rpr="<w:i/><w:iCs/>"),
    "Heading3": _style("Heading3", "heading 3", based="Normal", nxt="FirstParagraph",
                       link="Heading3Char",
                       ppr=_p("<w:keepNext/><w:keepLines/>",
                              '<w:numPr><w:ilvl w:val="2"/><w:numId w:val="900"/></w:numPr>',
                              _spacing(before=240, after=0),
                              '<w:outlineLvl w:val="2"/>')),
    # Level 4 is a run-in head in print. Word has no true run-in paragraph, so
    # it renders as an italic line with keepNext — the copyeditor runs it in.
    "Heading4": _style("Heading4", "heading 4", based="Normal", nxt="FirstParagraph",
                       link="Heading4Char",
                       ppr=_p("<w:keepNext/><w:keepLines/>", _spacing(before=240, after=0),
                              '<w:outlineLvl w:val="3"/>'),
                       rpr="<w:i/><w:iCs/>"),
    # Front/back matter heads (Abstract, References, Appendix A, Figure Legends)
    # must NOT take a section number. build_le_docx.py retags them to this style.
    "UnnumberedHeading": _style("UnnumberedHeading", "Unnumbered Heading", based="Normal",
                                nxt="FirstParagraph", custom=True,
                                ppr=_p("<w:keepNext/><w:keepLines/>",
                                       _spacing(before=360, after=0),
                                       '<w:outlineLvl w:val="0"/>'),
                                rpr="<w:b/><w:bCs/>"),

    # --- notes, quotes, references -----------------------------------------
    # JLE: footnotes double spaced, at body size. WordTeX uses 8pt single.
    # JLE also requires the acknowledgment note first and forbids purely
    # bibliographic footnotes (simple citations go in the text, author-date).
    "FootnoteText": _style("FootnoteText", "footnote text", based="Normal",
                           ppr=_p(_spacing(), '<w:ind w:firstLine="0"/>')),
    "FootnoteBlockText": _style("FootnoteBlockText", "Footnote Block Text",
                                based="FootnoteText",
                                ppr=_p(_spacing(), '<w:ind w:left="720" w:firstLine="0"/>')),
    "BlockText": _style("BlockText", "Block Text", based="Normal",
                        ppr=_p(_spacing(before=120, after=120),
                               '<w:ind w:left="720" w:right="0" w:firstLine="0"/>')),
    # Author-date reference list: hanging indent, double spaced, alphabetical.
    # WordTeX numbers its Bibliography (numId 12) — wrong for author-date.
    "Bibliography": _style("Bibliography", "Bibliography", based="Normal",
                           ppr=_p(_spacing(), '<w:ind w:left="720" w:hanging="720"/>')),

    # --- captions -----------------------------------------------------------
    # JLE: table titles brief, explanatory material in notes below the table;
    # figure legends live together on a separate double-spaced page.
    "Caption": _style("Caption", "caption", based="Normal",
                      ppr=_p(_spacing(before=120, after=120), '<w:jc w:val="left"/>',
                             '<w:ind w:firstLine="0"/>')),
    "TableCaption": _style("TableCaption", "Table Caption", based="Caption",
                           ppr=_p("<w:keepNext/>", _spacing(before=120, after=120),
                                  '<w:ind w:firstLine="0"/>')),
    "ImageCaption": _style("ImageCaption", "Image Caption", based="Caption",
                           ppr=_p(_spacing(before=120, after=120),
                                  '<w:ind w:firstLine="0"/>')),
    "Figure": _style("Figure", "Figure", based="Normal",
                     ppr=_p(_spacing(before=120, after=0), '<w:jc w:val="center"/>',
                            '<w:ind w:firstLine="0"/>')),
    "CaptionedFigure": _style("CaptionedFigure", "Captioned Figure", based="Figure",
                              ppr=_p(_spacing(before=120, after=0), '<w:keepNext/>',
                                     '<w:jc w:val="center"/><w:ind w:firstLine="0"/>')),
    # Table note under a table ("Note. — ..." plus the significance legend
    # + P < .10; * P < .05; ** P < .01). Double spaced like everything else.
    "TableNote": _style("TableNote", "Table Note", based="Normal", custom=True,
                        ppr=_p(_spacing(before=0, after=240), '<w:ind w:firstLine="0"/>',
                               '<w:jc w:val="left"/>')),

    # --- code ---------------------------------------------------------------
    "SourceCode": _style("SourceCode", "Source Code", based="Normal",
                         link="VerbatimChar",
                         ppr=_p(_spacing(line=240), '<w:jc w:val="left"/>',
                                '<w:ind w:firstLine="0"/>'),
                         rpr=f'<w:rFonts w:ascii="{MONO}" w:hAnsi="{MONO}"/><w:sz w:val="20"/>'),
    "VerbatimChar": _style("VerbatimChar", "Verbatim Char", typ="character",
                           based="DefaultParagraphFont",
                           rpr=f'<w:rFonts w:ascii="{MONO}" w:hAnsi="{MONO}"/><w:sz w:val="20"/>'),
}


def patch_styles(xml: str) -> str:
    """Replace each style definition we own; append the ones pandoc lacks."""
    for sid, new in STYLE_DEFS.items():
        pat = re.compile(
            r'<w:style\b[^>]*w:styleId="%s"\s*>.*?</w:style>' % re.escape(sid),
            re.DOTALL,
        )
        xml, n = pat.subn(lambda _m, v=new: v, xml, count=1)
        if n == 0:
            # Self-closing form, or a style pandoc does not ship (our customs).
            pat2 = re.compile(r'<w:style\b[^>]*w:styleId="%s"\s*/>' % re.escape(sid))
            xml, n2 = pat2.subn(lambda _m, v=new: v, xml, count=1)
            if n2 == 0:
                xml = xml.replace("</w:styles>", new + "</w:styles>")

    # Document defaults: body font + size, so anything unstyled still looks right.
    xml = re.sub(
        r"<w:rPrDefault>\s*<w:rPr>.*?</w:rPr>\s*</w:rPrDefault>",
        "<w:rPrDefault><w:rPr>"
        f'<w:rFonts w:ascii="{SERIF}" w:eastAsia="{SERIF}" w:hAnsi="{SERIF}" w:cs="{SERIF}"/>'
        f'<w:sz w:val="{BODY_HALF_PT}"/><w:szCs w:val="{BODY_HALF_PT}"/>'
        '<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/>'
        "</w:rPr></w:rPrDefault>",
        xml,
        flags=re.DOTALL,
    )
    xml = re.sub(
        r"<w:pPrDefault>.*?</w:pPrDefault>",
        "<w:pPrDefault><w:pPr><w:widowControl/>" + _spacing() + "</w:pPr></w:pPrDefault>",
        xml,
        flags=re.DOTALL,
    )
    return xml


HEADING_NUMBERING = (
    '<w:abstractNum w:abstractNumId="900">'
    '<w:nsid w:val="4c0e0001"/>'
    '<w:multiLevelType w:val="multilevel"/>'
    + "".join(
        f'<w:lvl w:ilvl="{i}">'
        '<w:start w:val="1"/><w:numFmt w:val="decimal"/>'
        f'<w:lvlText w:val="{lvl_text}"/>'
        '<w:lvlJc w:val="left"/>'
        f'<w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr>'
        "</w:lvl>"
        for i, lvl_text in enumerate(["%1.", "%1.%2.", "%1.%2.%3."])
    )
    + "".join(
        f'<w:lvl w:ilvl="{i}"><w:numFmt w:val="none"/><w:lvlText w:val=""/>'
        '<w:lvlJc w:val="left"/></w:lvl>'
        for i in range(3, 9)
    )
    + "</w:abstractNum>"
    '<w:num w:numId="900"><w:abstractNumId w:val="900"/></w:num>'
)


def patch_numbering(xml: str) -> str:
    if 'w:numId="900"' in xml:
        return xml
    # abstractNum elements must precede num elements; append the pair at the end,
    # which satisfies that ordering because pandoc's file ends with its own nums.
    body = HEADING_NUMBERING
    abstract = body[: body.index("<w:num ")]
    num = body[body.index("<w:num ") :]
    first_num = xml.find("<w:num ")
    if first_num == -1:
        return xml.replace("</w:numbering>", body + "</w:numbering>")
    return xml[:first_num] + abstract + xml[first_num:].replace(
        "</w:numbering>", num + "</w:numbering>"
    )


def patch_settings(xml: str) -> str:
    """Latin Modern Math for OMML, and drop embedSystemFonts."""
    xml = xml.replace('<m:mathFont m:val="Cambria Math" />',
                      f'<m:mathFont m:val="{MATH}"/>')
    xml = xml.replace('<m:mathFont m:val="Cambria Math"/>',
                      f'<m:mathFont m:val="{MATH}"/>')
    return xml


def patch_theme(xml: str) -> str:
    """Point the major/minor theme fonts at Latin Modern Roman."""
    xml = re.sub(r'<a:latin typeface="[^"]*"([^/]*)/>',
                 lambda m: f'<a:latin typeface="{SERIF}"{m.group(1)}/>', xml)
    xml = re.sub(r'<a:cs typeface="[^"]*"([^/]*)/>',
                 lambda m: f'<a:cs typeface="{SERIF}"{m.group(1)}/>', xml)
    return xml


def patch_fonttable(xml: str) -> str:
    entries = "".join(
        f'<w:font w:name="{name}"><w:family w:val="{fam}"/>'
        '<w:pitch w:val="variable"/></w:font>'
        for name, fam in ((SERIF, "roman"), (SERIF_ALT, "roman"),
                          (MONO, "modern"), (MATH, "roman"))
    )
    return xml.replace("</w:fonts>", entries + "</w:fonts>")


# US Letter, 1in margins, page-number footer, footnotes numbered continuously
# through the whole manuscript (JLE: appendix footnotes continue the main run).
SECT_PR = (
    "<w:sectPr>"
    '<w:footerReference w:type="default" r:id="rIdLEFooter"/>'
    '<w:pgSz w:w="12240" w:h="15840"/>'
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
    'w:header="720" w:footer="720" w:gutter="0"/>'
    '<w:footnotePr><w:numFmt w:val="decimal"/><w:numRestart w:val="continuous"/></w:footnotePr>'
    "</w:sectPr>"
)

FOOTER_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<w:ftr xmlns:w="{W}" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<w:p><w:pPr><w:jc w:val="center"/>'
    '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    '<w:r><w:t>1</w:t></w:r>'
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    "</w:p></w:ftr>"
)


def patch_document(xml: str) -> str:
    return re.sub(r"<w:sectPr>.*?</w:sectPr>", SECT_PR, xml, flags=re.DOTALL)


def patch_doc_rels(xml: str) -> str:
    if "rIdLEFooter" in xml:
        return xml
    rel = ('<Relationship Id="rIdLEFooter" '
           'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" '
           'Target="footer1.xml"/>')
    return xml.replace("</Relationships>", rel + "</Relationships>")


def patch_content_types(xml: str) -> str:
    if "footer1.xml" in xml:
        return xml
    ov = ('<Override PartName="/word/footer1.xml" ContentType="application/vnd.'
          'openxmlformats-officedocument.wordprocessingml.footer+xml"/>')
    return xml.replace("</Types>", ov + "</Types>")


PATCHES = {
    "word/styles.xml": patch_styles,
    "word/numbering.xml": patch_numbering,
    "word/settings.xml": patch_settings,
    "word/theme/theme1.xml": patch_theme,
    "word/fontTable.xml": patch_fonttable,
    "word/document.xml": patch_document,
    "word/_rels/document.xml.rels": patch_doc_rels,
    "[Content_Types].xml": patch_content_types,
}

DEFAULT_OUT = (Path(__file__).resolve().parents[2]
               / "writing-legal" / "templates" / "law_econ_template.docx")


def build(out: Path) -> Path:
    if not shutil.which("pandoc"):
        sys.exit("ERROR: pandoc not found on PATH")
    with tempfile.TemporaryDirectory() as td:
        base = Path(td) / "reference.docx"
        base.write_bytes(
            subprocess.run(["pandoc", "--print-default-data-file", "reference.docx"],
                           capture_output=True, check=True).stdout
        )
        with zipfile.ZipFile(base) as z:
            parts = {n: z.read(n) for n in z.namelist()}

    for name, fn in PATCHES.items():
        if name not in parts:
            sys.exit(f"ERROR: pandoc reference.docx is missing {name}; "
                     "the pandoc version changed shape — update make_le_template.py")
        parts[name] = fn(parts[name].decode("utf-8")).encode("utf-8")
    parts["word/footer1.xml"] = FOOTER_XML.encode("utf-8")

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)

    # Fail loudly rather than shipping a template pandoc silently ignores.
    verify(out)
    return out


REQUIRED_STYLES = ["Normal", "BodyText", "FirstParagraph", "Title", "Author",
                   "Abstract", "AbstractTitle", "Heading1", "Heading2", "Heading3",
                   "FootnoteText", "Bibliography", "TableCaption", "ImageCaption",
                   "UnnumberedHeading", "TableNote", "SourceCode"]


def verify(path: Path) -> None:
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        missing = {"word/styles.xml", "word/numbering.xml", "word/settings.xml",
                   "word/footer1.xml", "[Content_Types].xml"} - names
        if missing:
            sys.exit(f"ERROR: generated template missing parts: {sorted(missing)}")
        styles = z.read("word/styles.xml").decode("utf-8")
    absent = [s for s in REQUIRED_STYLES if f'w:styleId="{s}"' not in styles]
    if absent:
        sys.exit(f"ERROR: generated template missing styles: {absent}")
    if f'w:val="{DOUBLE}"' not in styles.replace('w:line="', 'w:val="'):
        sys.exit("ERROR: generated template is not double spaced")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    out = build(args.output)
    print(f"Wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
