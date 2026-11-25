#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pikepdf"]
# ///
"""Strip identifying and stale metadata from an expert report's .docx parts and Word PDF.

    uv run --script strip_metadata.py PDF...      # strip PDFs in place; one line per file

Owner's rule: always strip metadata. build_docx.py runs strip_ooxml on every build and
strip_pdf after every Word render; make_template.py runs strip_ooxml on the template.

Policy (differs from expert-production's scrub_metadata.py, which keeps dates and drops the
producer): the .docx keeps no dates and no names; the PDF keeps only Creator and Producer, which
the Microsoft Word check in build_docx.py reads.
"""

from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

CORE_EMPTY = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
              'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
              'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>')
# What app.xml keeps: the flags, none identifying or derived from the text. Statistics, Template,
# Company, Manager, HyperlinkBase, TotalTime and pandoc's stale "Microsoft Word 12.0.0"
# Application/AppVersion go. Word opens and renders the file with this (2026-11-10, word-remote).
APP_KEEP = ("DocSecurity", "ScaleCrop", "SharedDoc", "LinksUpToDate", "HyperlinksChanged")
REMOVED_PARTS = ("docProps/custom.xml", "word/people.xml", "docProps/thumbnail.jpeg",
                 "docProps/thumbnail.wmf", "docProps/thumbnail.emf", "docProps/thumbnail.png")
# Revision-save ids, the attached template's path and the document GUIDs identify the authoring
# machine and session; Word regenerates them on save and needs none of them to open the file.
SETTINGS_STRIP = (("w:rsids", r"<w:rsids>.*?</w:rsids>|<w:rsids\s*/>"), ("w:rsidRoot", r"<w:rsidRoot\b[^>]*/>"),
                  ("w:attachedTemplate", r"<w:attachedTemplate\b[^>]*/>"),
                  ("w14:docId", r"<w14:docId\b[^>]*/>"), ("w15:docId", r"<w15:docId\b[^>]*/>"))
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)  # the ZIP format's zero date: no date


def _fields(xml: str) -> list[str]:
    return [t for t, v in re.findall(r"<([\w:]+)(?:\s[^>]*)?>([^<]*)</\1>", xml) if v.strip()]


def strip_ooxml(parts: dict[str, bytes]) -> list[str]:
    """Strip metadata from a docx's parts in place; return what was stripped, one entry each."""
    out: list[str] = []
    if "docProps/core.xml" in parts:
        core = parts["docProps/core.xml"].decode("utf-8")
        found = [f for f in _fields(core) if f != "cp:coreProperties"]
        if found:
            out.append("core.xml " + ", ".join(found))
        parts["docProps/core.xml"] = CORE_EMPTY.encode()
    if "docProps/app.xml" in parts:
        app = parts["docProps/app.xml"].decode("utf-8")
        gone = [t for t in dict.fromkeys(re.findall(r"<(\w+)>", app)) if t not in APP_KEEP + ("Properties",)]
        keep = "".join(m.group(0) for m in re.finditer(r"<(%s)>[^<]*</\1>" % "|".join(APP_KEEP), app))
        if gone:
            out.append("app.xml " + ", ".join(gone))
        parts["docProps/app.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
            + keep + "</Properties>").encode()
    for name in REMOVED_PARTS:
        if name in parts:
            del parts[name]
            out.append(name)
        target = name.split("/", 1)[1]
        for rels in ("_rels/.rels", "word/_rels/document.xml.rels"):
            if rels in parts:
                parts[rels] = re.sub(rb'<Relationship\b[^>]*Target="/?(?:docProps/|word/)?%s"[^>]*/>'
                                     % re.escape(target).encode(), b"", parts[rels])
        if "[Content_Types].xml" in parts:
            parts["[Content_Types].xml"] = re.sub(rb'<Override\b[^>]*PartName="/%s"[^>]*/>'
                                                  % re.escape(name).encode(), b"", parts["[Content_Types].xml"])
    if "word/settings.xml" in parts:
        st = parts["word/settings.xml"].decode("utf-8")
        for label, pat in SETTINGS_STRIP:
            st, n = re.subn(pat, "", st, flags=re.S)
            if n:
                out.append("settings.xml " + label)
        parts["word/settings.xml"] = st.encode()
    rsid = author = date = 0
    for name in [n for n in parts if n.startswith("word/") and n.endswith(".xml")]:
        xml = parts[name].decode("utf-8")
        xml, a = re.subn(r'\s+w:rsid\w*="[^"]*"', "", xml)
        xml, b = re.subn(r'\b(w:(?:author|initials))="[^"]+"', r'\1=""', xml)
        xml, c = re.subn(r'\s+w:date="[^"]*"', "", xml)
        rsid, author, date = rsid + a, author + b, date + c
        parts[name] = xml.encode()
    for label, n in (("rsid attributes", rsid), ("w:author/w:initials", author), ("w:date", date)):
        if n:
            out.append(f"{label} ({n})")
    return out


def write_zip(path: Path, parts: dict[str, bytes]) -> None:
    """[Content_Types].xml first; every entry dated the ZIP epoch, so the archive carries no date."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(parts, key=lambda n: n != "[Content_Types].xml"):
            info = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, parts[name])


INFO_KEEP = ("/Creator", "/Producer")
NS = {"http://purl.org/dc/elements/1.1/": "dc", "http://ns.adobe.com/pdf/1.3/": "pdf",
      "http://ns.adobe.com/xap/1.0/": "xmp", "http://ns.adobe.com/xap/1.0/mm/": "xmpMM"}
XMP_KEEP = ("{http://ns.adobe.com/pdf/1.3/}Producer", "{http://ns.adobe.com/xap/1.0/}CreatorTool")


def _qname(clark: str) -> str:
    m = re.match(r"\{([^}]*)\}(.*)", clark)
    return f"{NS.get(m.group(1), m.group(1))}:{m.group(2)}" if m else clark


def strip_pdf(path: Path) -> list[str]:
    """Drop every Info entry but Creator and Producer, and every XMP property but pdf:Producer and
    xmp:CreatorTool (dates, dc:creator/title/description, pdf:Keywords, document/instance ids)."""
    import pikepdf
    out: list[str] = []
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        for k in [k for k in pdf.docinfo if str(k) not in INFO_KEEP]:
            out.append(str(k).lstrip("/"))
            del pdf.docinfo[k]
        if pdf.Root.get("/Metadata") is not None:
            with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as meta:
                for k in [k for k in meta if k not in XMP_KEEP]:
                    out.append(_qname(k))
                    del meta[k]
        pdf.save(path)
    return out


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    for a in argv:
        print(f"PDF metadata stripped: {', '.join(strip_pdf(Path(a))) or 'nothing'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
