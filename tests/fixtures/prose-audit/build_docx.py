#!/usr/bin/env python3
"""Build the .docx audit fixture.

NOT COMMITTED AS A BINARY. `scripts/scan-public-privacy.ts` requires every tracked binary to carry
a reviewed disposition in a candidate manifest, and minting one for a test fixture would put a
governance artifact in the repo to describe five sentences of Lorem. The bytes are generated
instead — which also makes the fixture readable in review, which a .docx never is.

Two paragraph sets on purpose: `word/document.xml` is body, `word/footnotes.xml` is a footnote the
audit must never report a finding inside.

Regenerate by hand with:
    python3 tests/fixtures/prose-audit/build_docx.py /tmp/manuscript.docx
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

BODY = [
    "The merger stands as a testament to the board&#8217;s diligence.",
    "The filing is a rich tapestry of disclosures that plays a vital role in the record.",
    "Despite these challenges, the parties closed.",
    "As an AI language model, I cannot confirm the closing date. I hope this helps.",
    "The staff cited citeturn0search0 and the oaicite marker survived the paste.",
]
FOOTNOTES = [
    "A footnote that is itself a rich tapestry and stands as a testament to nothing.",
]

_CONTENT_TYPES = (
    "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
    "</Types>"
)
_RELS = (
    "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/></Relationships>'
)


def _paragraphs(texts) -> str:
    return "".join(f"<w:p><w:r><w:t xml:space='preserve'>{t}</w:t></w:r></w:p>" for t in texts)


def build(path) -> Path:
    path = Path(path)
    doc = (f"<?xml version='1.0' encoding='UTF-8' standalone='yes'?><w:document {_W}>"
           f"<w:body>{_paragraphs(BODY)}</w:body></w:document>")
    fn = (f"<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
          f"<w:footnotes {_W}>{_paragraphs(FOOTNOTES)}</w:footnotes>")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/document.xml", doc)
        z.writestr("word/footnotes.xml", fn)
    return path


if __name__ == "__main__":
    print(build(sys.argv[1] if len(sys.argv) > 1 else "manuscript.docx"))
