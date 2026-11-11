#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Generate the expert-report pandoc reference document.

    uv run python3 make_template.py [-o OUT.docx]

The template is BUILT from ``pandoc --print-default-data-file reference.docx``, never edited
in Word, so every layout value is auditable here. Each value is the one measured from the
served reference report (PDF points and the served .docx's twips); the measurements are in
docs/investigations/2026-11-10_expert-report-template.md. 1 pt = 20 twips; sizes are half-points.
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
FONT = "Times New Roman"
RFONTS = f'<w:rFonts w:ascii="{FONT}" w:eastAsia="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}"/>'

BODY = 24            # 12 pt
NOTE = 20            # 10 pt
SINGLE = 240         # w:line, lineRule auto: TNR 12 -> 13.8 pt pitch
DOUBLE = 480         # 27.6 pt pitch
NOTE_LINE = 230      # exact 11.5 pt footnote pitch
BLANK = 276          # one blank single-spaced 12 pt line (13.8 pt), the served gap around
                     # headings, block quotes and ordinal points
INDENT = 720         # 0.5"
# Block quotes are indented 0.5" on both sides (served: quote lines x 108-504, .docx
# w:left="720" w:right="720").
BLOCK_RIGHT = 720


def _spacing(before: int = 0, after: int = 0, line: int = SINGLE, rule: str = "auto") -> str:
    return f'<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="{rule}"/>'


def _style(sid: str, name: str, *, based: str | None = "Normal", nxt: str | None = None,
           ppr: str = "", rpr: str = "", typ: str = "paragraph", custom: bool = False,
           default: bool = False) -> str:
    attrs = f'w:type="{typ}"' + (' w:default="1"' if default else "") + \
        (' w:customStyle="1"' if custom else "") + f' w:styleId="{sid}"'
    parts = [f'<w:name w:val="{name}"/>']
    if based:
        parts.append(f'<w:basedOn w:val="{based}"/>')
    if nxt:
        parts.append(f'<w:next w:val="{nxt}"/>')
    parts.append("<w:qFormat/>")
    if ppr:
        parts.append(f"<w:pPr>{ppr}</w:pPr>")
    if rpr:
        parts.append(f"<w:rPr>{rpr}</w:rPr>")
    return f"<w:style {attrs}>" + "".join(parts) + "</w:style>"


SZ = lambda hp: f'<w:sz w:val="{hp}"/><w:szCs w:val="{hp}"/>'  # noqa: E731

STYLE_DEFS: dict[str, str] = {
    "Normal": _style("Normal", "Normal", based=None, default=True,
                     ppr=_spacing() + '<w:jc w:val="left"/>',
                     rpr=RFONTS + SZ(BODY)),
    # Body: double-spaced, justified; the paragraph number sits at the 0.5" first-line indent
    # and a tab carries the text to the next default stop at 1.0" (x 143.9 in the served PDF).
    "BodyText": _style("BodyText", "Body Text", nxt="BodyText",
                       ppr=_spacing(line=DOUBLE) + '<w:ind w:firstLine="720"/><w:jc w:val="both"/>'),
    "FirstParagraph": _style("FirstParagraph", "First Paragraph", based="BodyText", nxt="BodyText",
                             ppr=_spacing(line=DOUBLE) + '<w:ind w:firstLine="720"/><w:jc w:val="both"/>'),
    "Compact": _style("Compact", "Compact", based="BodyText",
                      ppr=_spacing(line=SINGLE, after=BLANK) + '<w:ind w:firstLine="0"/>'),
    # Part heading: flush left, numeral at x 72, tab to 0.5", wrapped lines at 0.5", bold caps,
    # one blank line above and below.
    "Heading1": _style("Heading1", "heading 1", nxt="BodyText",
                       ppr="<w:keepNext/><w:keepLines/>" + _spacing(before=BLANK, after=BLANK)
                       + '<w:ind w:left="720" w:hanging="720"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/>',
                       rpr="<w:b/><w:bCs/><w:caps/>"),
    # Lettered heading: letter at 0.5", tab to 1.0", wrapped lines at 1.0".
    "Heading2": _style("Heading2", "heading 2", nxt="BodyText",
                       ppr="<w:keepNext/><w:keepLines/>" + _spacing(before=BLANK, after=BLANK)
                       + '<w:ind w:left="1440" w:hanging="720"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/>',
                       rpr="<w:b/><w:bCs/><w:caps/>"),
    "Heading3": _style("Heading3", "heading 3", nxt="BodyText",
                       ppr="<w:keepNext/><w:keepLines/>" + _spacing(before=BLANK, after=BLANK)
                       + '<w:ind w:left="2160" w:hanging="720"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/>',
                       rpr="<w:b/><w:bCs/>"),
    # Block quote: single-spaced (13.8 pt pitch), 0.5" each side, one blank line after.
    "BlockText": _style("BlockText", "Block Text", nxt="BodyText",
                        ppr=_spacing(after=BLANK)
                        + f'<w:ind w:left="720" w:right="{BLOCK_RIGHT}" w:firstLine="0"/><w:jc w:val="both"/>'),
    # Footnote: 10 pt at an exact 11.5 pt pitch, no space between notes; the number sits at the
    # 0.5" first-line indent followed by a space, and wrapped lines return to the margin.
    "FootnoteText": _style("FootnoteText", "footnote text",
                           ppr=_spacing(line=NOTE_LINE, rule="exact")
                           + '<w:ind w:left="0" w:firstLine="720"/><w:jc w:val="both"/>',
                           rpr=SZ(NOTE)),
    "FootnoteBlockText": _style("FootnoteBlockText", "Footnote Block Text", based="FootnoteText",
                                ppr=_spacing(line=NOTE_LINE, rule="exact")
                                + '<w:ind w:left="720" w:right="720" w:firstLine="0"/>'),
    # Superscript, as in the served .docx: Word draws it at 2/3 of the run (8 pt in the body,
    # 6.7 pt in a note; served 8.0 / 6.5). LibreOffice ignores any size or position on a
    # footnote mark and applies its own 58% superscript, so explicit sizes only shrink it there.
    "FootnoteReference": _style("FootnoteReference", "footnote reference", typ="character",
                                based="DefaultParagraphFont", rpr='<w:vertAlign w:val="superscript"/>'),
    "Placeholder": _style("Placeholder", "Placeholder", typ="character", custom=True,
                          based="DefaultParagraphFont", rpr='<w:highlight w:val="yellow"/>'),
    # --- caption (page 1): court centred; the party and title columns live in a table the
    # build writes, using these styles.
    "CaptionCourt": _style("CaptionCourt", "Caption Court", custom=True,
                           ppr=_spacing() + '<w:jc w:val="center"/>', rpr="<w:b/><w:bCs/>"),
    "CaptionLeft": _style("CaptionLeft", "Caption Left", custom=True,
                          ppr=_spacing() + '<w:jc w:val="left"/>'),
    "CaptionRight": _style("CaptionRight", "Caption Right", custom=True,
                           ppr=_spacing() + '<w:jc w:val="left"/>'),
    # --- closing
    # Four asterisks at x 249/285/321/357 in the served PDF: first at 3540 twips, tabs 0.5" apart.
    "AsteriskBreak": _style("AsteriskBreak", "Asterisk Break", custom=True, nxt="BodyText",
                            ppr='<w:keepNext/><w:tabs><w:tab w:val="left" w:pos="4260"/>'
                            '<w:tab w:val="left" w:pos="4980"/><w:tab w:val="left" w:pos="5700"/></w:tabs>'
                            + _spacing(line=DOUBLE) + '<w:ind w:left="3540" w:firstLine="0"/><w:jc w:val="left"/>'),
    # Ordinal conclusions (*First*, ...): bullet at 0.5", text at 0.75", single-spaced, blank after.
    "OrdinalPoint": _style("OrdinalPoint", "Ordinal Point", custom=True, nxt="BodyText",
                           ppr=_spacing(after=BLANK)
                           + '<w:ind w:left="1080" w:hanging="360"/><w:jc w:val="both"/>'),
    # Typed name at 4" (x 360), with room above for the signature; contextual spacing keeps a
    # signature placeholder line and the name together.
    "Signature": _style("Signature", "Signature", custom=True,
                        ppr="<w:keepNext/><w:keepLines/><w:contextualSpacing/>" + _spacing(before=720)
                        + '<w:ind w:left="5760" w:firstLine="0"/><w:jc w:val="left"/>'),
    "SignatureDate": _style("SignatureDate", "Signature Date", custom=True,
                            ppr=_spacing(before=BLANK) + '<w:ind w:left="0" w:firstLine="0"/><w:jc w:val="left"/>'),
    # Exhibit slip page: "EXHIBIT A" centred low on its own page.
    "ExhibitTitle": _style("ExhibitTitle", "Exhibit Title", custom=True,
                           ppr="<w:pageBreakBefore/>" + _spacing(before=4800)
                           + '<w:ind w:firstLine="0"/><w:jc w:val="center"/>',
                           rpr="<w:b/><w:bCs/>" + SZ(56)),
    "ExhibitHeading": _style("ExhibitHeading", "Exhibit Heading", custom=True,
                             ppr="<w:keepNext/>" + _spacing(after=BLANK)
                             + '<w:ind w:firstLine="0"/><w:jc w:val="center"/>',
                             rpr="<w:b/><w:bCs/><w:caps/>"),
    "Header": _style("Header", "header", ppr=_spacing() + '<w:jc w:val="center"/>'),
    "Footer": _style("Footer", "footer", ppr=_spacing() + '<w:jc w:val="center"/>', rpr=SZ(22)),
}

REQUIRED_STYLES = list(STYLE_DEFS)


def patch_styles(xml: str) -> str:
    for sid, new in STYLE_DEFS.items():
        pat = re.compile(r'<w:style\b[^>]*w:styleId="%s"[^>]*>.*?</w:style>' % re.escape(sid), re.S)
        xml, n = pat.subn(lambda _m, v=new: v, xml, count=1)
        if n == 0:
            xml = xml.replace("</w:styles>", new + "</w:styles>")
    xml = re.sub(r"<w:rPrDefault>.*?</w:rPrDefault>",
                 "<w:rPrDefault><w:rPr>" + RFONTS + SZ(BODY)
                 + '<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>',
                 xml, flags=re.S)
    xml = re.sub(r"<w:pPrDefault>.*?</w:pPrDefault>",
                 "<w:pPrDefault><w:pPr><w:widowControl/>" + _spacing() + "</w:pPr></w:pPrDefault>",
                 xml, flags=re.S)
    return xml


# Word 2010 mode (14), as served. In mode 15 Word draws the continuation separator 2" long; in
# 14 full width (468 pt). Mode 14 also hangs a table's border one cell margin left of the text,
# so the caption table at tblInd 0 has its border at x 66.6 and its text at the margin.
COMPAT = ('<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/>'
          '<w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>'
          '<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>'
          '<w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat>')


def patch_settings(xml: str) -> str:
    xml = re.sub(r"<w:embedSystemFonts\s*/>", "", xml)
    xml = re.sub(r"<w:compat>.*?</w:compat>", "", xml, flags=re.S)
    # compat follows footnotePr/endnotePr in the CT_Settings sequence
    return re.sub(r"(</w:footnotePr>)", r"\1" + COMPAT, xml, count=1)


def patch_theme(xml: str) -> str:
    xml = re.sub(r'<a:latin typeface="[^"]*"', f'<a:latin typeface="{FONT}"', xml)
    return re.sub(r'<a:cs typeface="[^"]*"', f'<a:cs typeface="{FONT}"', xml)


# Letter, 1" margins, footer 0.5" from the edge, page 1 numbered (no titlePg), no header.
SECT_PR = ("<w:sectPr>"
           '<w:footerReference w:type="default" r:id="rIdERFooter"/>'
           '<w:footnotePr><w:numFmt w:val="decimal"/><w:numRestart w:val="continuous"/></w:footnotePr>'
           '<w:pgSz w:w="12240" w:h="15840"/>'
           '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" '
           'w:header="720" w:footer="720" w:gutter="0"/>'
           '<w:cols w:space="720"/></w:sectPr>')

_FR = f"<w:rPr>{RFONTS}{SZ(22)}</w:rPr>"
# Served footer: a bare 11 pt page number centred, then an empty 11 pt paragraph (baselines
# 739.9 and 752.9 with the footer 0.5" from the edge).
FOOTER_XML = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              f'<w:ftr xmlns:w="{W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
              f'<w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/>{_FR}</w:pPr>'
              f'<w:r>{_FR}<w:fldChar w:fldCharType="begin"/></w:r>'
              f'<w:r>{_FR}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
              f'<w:r>{_FR}<w:fldChar w:fldCharType="separate"/></w:r>'
              f'<w:r>{_FR}<w:t>1</w:t></w:r>'
              f'<w:r>{_FR}<w:fldChar w:fldCharType="end"/></w:r></w:p>'
              f'<w:p><w:pPr><w:pStyle w:val="Footer"/>{_FR}</w:pPr></w:p></w:ftr>')


def patch_document(xml: str) -> str:
    if "<w:sectPr" in xml:
        return re.sub(r"<w:sectPr\b.*?</w:sectPr>", SECT_PR, xml, flags=re.S)
    return xml.replace("</w:body>", SECT_PR + "</w:body>")


def patch_doc_rels(xml: str) -> str:
    if "rIdERFooter" in xml:
        return xml
    return xml.replace("</Relationships>",
                       '<Relationship Id="rIdERFooter" Type="http://schemas.openxmlformats.org/'
                       'officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>')


def patch_content_types(xml: str) -> str:
    if "footer1.xml" in xml:
        return xml
    return xml.replace("</Types>", '<Override PartName="/word/footer1.xml" ContentType="application/'
                       'vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')


PATCHES = {
    "word/styles.xml": patch_styles,
    "word/settings.xml": patch_settings,
    "word/theme/theme1.xml": patch_theme,
    "word/document.xml": patch_document,
    "word/_rels/document.xml.rels": patch_doc_rels,
    "[Content_Types].xml": patch_content_types,
}

def _strip_metadata():
    """strip_metadata.py, loaded by path under a unique name (no sys.path collisions)."""
    spec = importlib.util.spec_from_file_location("expert_report_strip_metadata",
                                                  Path(__file__).resolve().parent / "strip_metadata.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


DEFAULT_OUT = Path(__file__).resolve().parents[1] / "references" / "templates" / "expert_report_template.docx"


def build(out: Path = DEFAULT_OUT) -> Path:
    if not shutil.which("pandoc"):
        sys.exit("ERROR: pandoc not found on PATH")
    with tempfile.TemporaryDirectory() as td:
        base = Path(td) / "reference.docx"
        base.write_bytes(subprocess.run(["pandoc", "--print-default-data-file", "reference.docx"],
                                        capture_output=True, check=True).stdout)
        with zipfile.ZipFile(base) as z:
            parts = {n: z.read(n) for n in z.namelist()}
    for name, fn in PATCHES.items():
        if name not in parts:
            sys.exit(f"ERROR: pandoc reference.docx is missing {name}; update make_template.py")
        parts[name] = fn(parts[name].decode("utf-8")).encode("utf-8")
    parts["word/footer1.xml"] = FOOTER_XML.encode("utf-8")
    sm = _strip_metadata()
    sm.strip_ooxml(parts)  # pandoc's reference.docx: "Title"/"Author", 2017 dates, Word 12 statistics
    out.parent.mkdir(parents=True, exist_ok=True)
    sm.write_zip(out, dict(sorted(parts.items())))
    verify(out)
    return out


def verify(path: Path) -> None:
    """Fail loudly rather than ship a template pandoc silently ignores."""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        missing = {"word/styles.xml", "word/settings.xml", "word/document.xml",
                   "word/footer1.xml", "[Content_Types].xml"} - names
        if missing:
            sys.exit(f"ERROR: generated template missing parts: {sorted(missing)}")
        styles = z.read("word/styles.xml").decode("utf-8")
        doc = z.read("word/document.xml").decode("utf-8")
        settings = z.read("word/settings.xml").decode("utf-8")
        core = z.read("docProps/core.xml").decode("utf-8") if "docProps/core.xml" in names else ""
        app = z.read("docProps/app.xml").decode("utf-8") if "docProps/app.xml" in names else ""
    absent = [s for s in REQUIRED_STYLES if f'w:styleId="{s}"' not in styles]
    if absent:
        sys.exit(f"ERROR: generated template missing styles: {absent}")
    checks = {
        "Letter page with 1-inch margins": '<w:pgSz w:w="12240" w:h="15840"/>' in doc
        and 'w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"' in doc,
        "footer reference and no header": "footerReference" in doc and "headerReference" not in doc,
        "page 1 numbered (no titlePg)": "titlePg" not in doc,
        "exact 11.5 pt footnote pitch": f'w:line="{NOTE_LINE}" w:lineRule="exact"' in styles,
        "double-spaced body": f'w:line="{DOUBLE}"' in styles,
        "Word 2010 compat mode": bool(re.search(r'w:name="compatibilityMode"[^>]*w:val="14"', settings)),
        "no core properties": not re.search(r"<(?:dc:|dcterms:|cp:(?!coreProperties))\w+", core),
        "no app.xml statistics or template": not re.search(r"<(?:Words|Pages|Template|Application)>", app),
        "no custom.xml": "docProps/custom.xml" not in names,
    }
    bad = [k for k, ok in checks.items() if not ok]
    if bad:
        sys.exit(f"ERROR: generated template fails: {bad}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    out = build(ap.parse_args().output)
    print(f"Wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
