#!/usr/bin/env -S uv run python3
"""
Combine law review markdown drafts into a single DOCX using pandoc
with the law review reference template.

Usage:
    uv run python3 build_docx.py PROJECT_DIR [--output PATH] [--fix-footnotes]

PROJECT_DIR must contain:
    - drafts/*.md  (section drafts)
    - .planning/ACTIVE_WORKFLOW.md (for title/author metadata)
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "bluebook-audit" / "scripts"))
from bluebook_signal_linter import lint as bluebook_lint, find_stacked_footnotes  # noqa: E402

TEMPLATE = Path(__file__).resolve().parents[3] / "references" / "templates" / "law_review_template.docx"

SECTION_ORDER = [
    "Introduction",
    "Part I",
    "Part II",
    "Part III",
    "Part IV",
    "Part V",
    "Part VI",
    "Conclusion",
    "Appendix",
    "Statistical Appendix",
]

PREFIXES = {
    "Introduction": "intro",
    "Part I": "p1",
    "Part II": "p2",
    "Part III": "p3",
    "Part IV": "p4",
    "Part V": "p5",
    "Part VI": "p6",
    "Conclusion": "conc",
    "Appendix": "app",
    "Statistical Appendix": "sapp",
}


def sort_key(path: Path) -> int:
    stem = path.stem.replace(" (Draft)", "")
    matches = [
        (i, section) for i, section in enumerate(SECTION_ORDER)
        if stem == section or stem.startswith(section + " ") or stem.startswith(section + ".")
    ]
    if not matches:
        return 100
    return max(matches, key=lambda m: len(m[1]))[0]


def strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            return text[end + 3:].lstrip("\n")
    return text


def prefix_footnotes(text: str, prefix: str) -> str:
    text = re.sub(r'\[\^([^\]]+)\](?!:)', lambda m: f'[^{prefix}_{m.group(1)}]', text)
    text = re.sub(r'\[\^([^\]]+)\]:', lambda m: f'[^{prefix}_{m.group(1)}]:', text)
    return text


INCLUDE_RE = re.compile(r'<!--\s*include:\s*([^\s][^>]*?)\s*-->')
# Strip legacy "Table N (body). ..." or "Table IV.A. ..." caption lines at the
# top of included body files. Pandoc-crossref provides the auto-numbered caption
# in the draft instead.
LEGACY_CAPTION_RE = re.compile(
    r'^Table\s+[A-Z0-9]+(?:\.[A-Z0-9]+)?(?:\s*\(body\))?\.\s+[^\n]*\n\n?',
    re.MULTILINE,
)


def resolve_includes(text: str) -> str:
    def repl(m: re.Match) -> str:
        raw = m.group(1).strip()
        path = Path(raw).expanduser()
        if not path.is_absolute():
            return f'<!-- MISSING (not absolute): {raw} -->'
        if not path.exists():
            return f'<!-- MISSING: {path} -->'
        body = path.read_text()
        # Drop the legacy caption line if present so pandoc-crossref can
        # attach its own auto-numbered caption to the bare table.
        body = LEGACY_CAPTION_RE.sub('', body, count=1)
        return body
    return INCLUDE_RE.sub(repl, text)


def get_prefix(path: Path) -> str:
    stem = path.stem.replace(" (Draft)", "")
    for section in sorted(PREFIXES, key=len, reverse=True):
        if stem == section or stem.startswith(section + " ") or stem.startswith(section + "."):
            return PREFIXES[section]
    return stem.lower().replace(" ", "_")[:6]



# Vendored beside the skill, not under ~/projects: the old home-relative default
# silently missed on any machine that had not cloned that repo, and a missing CSL
# means citeproc falls back to its own style rather than Bluebook.
DEFAULT_CSL = Path(__file__).resolve().parent.parent / "assets" / "bluebook-law-review-21e.csl"


SVG_EXT_NS = "http://schemas.microsoft.com/office/drawing/2016/SVG/main"
SVG_EXT_URI = "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"


def attach_svg_blips(docx: Path, project_dir: Path,
                     search_dirs: list[Path] | None = None) -> None:
    """Give every embedded raster its SVG twin so Word draws the figure as vector.

    Word 2016+ renders SVG natively, but only through the svgBlip extension: the
    a:blip keeps pointing at a raster fallback and carries the vector alongside
    it as an extension. Pandoc emits no such thing, which is why handing pandoc a
    bare .svg drops the image from the document without a word of warning.

    Converting to EMF through LibreOffice is NOT an equivalent substitute.
    LibreOffice's SVG importer silently mangles complex figures -- a faceted
    histogram came back missing an entire facet row, every row label, both axis
    labels and the zero line, while still looking like a plausible chart. This
    path never leaves Word's own renderer.

    Figures are matched to their SVG by CONTENT, because pandoc rewrites embedded
    media to rIdN.png and the original filename is gone by this point. Does
    nothing when no sibling .svg exists, so raster-only projects are unaffected.

    ``search_dirs`` overrides where the PNG/SVG pairs are looked for. The law
    review layout (the default) keeps figures under figures/ or drafts/; the
    law-econ sibling keeps them beside the source file, so build_le_docx.py
    passes its own list rather than assuming this project shape.
    """
    import hashlib
    import zipfile

    if search_dirs is None:
        search_dirs = [project_dir / "figures", project_dir / "drafts", project_dir]
    figure_svgs: dict[str, Path] = {}
    for figdir in search_dirs:
        if not figdir.is_dir():
            continue
        for png in figdir.glob("*.png"):
            svg = png.with_suffix(".svg")
            if svg.is_file():
                figure_svgs[hashlib.sha256(png.read_bytes()).hexdigest()] = svg
    if not figure_svgs:
        return

    with zipfile.ZipFile(docx) as src:
        items = {n: src.read(n) for n in src.namelist()}

    rels = items["word/_rels/document.xml.rels"].decode()
    doc = items["word/document.xml"].decode()
    attached: list[str] = []
    next_n = max((int(x) for x in re.findall(r'Id="rId(\d+)"', rels)), default=0) + 1

    for tag in re.findall(r"<Relationship\b[^>]*/>", rels):
        rid = re.search(r'Id="([^"]+)"', tag)
        target = re.search(r'Target="(media/[^"]+)"', tag)
        if not rid or not target:
            continue
        data = items.get("word/" + target.group(1))
        if data is None:
            continue
        svg_path = figure_svgs.get(hashlib.sha256(data).hexdigest())
        if svg_path is None:
            continue

        svg_name = "media/%s.svg" % svg_path.stem
        svg_rid = "rId%d" % next_n
        next_n += 1
        ext = (
            '<a:extLst><a:ext uri="%s">'
            '<asvg:svgBlip xmlns:asvg="%s" r:embed="%s"/>'
            "</a:ext></a:extLst>" % (SVG_EXT_URI, SVG_EXT_NS, svg_rid)
        )
        # The blip may or may not be self-closing, and pandoc writes a space
        # before the slash, so it is matched by pattern rather than literally.
        blip = re.compile(r'<a:blip([^>]*r:embed="%s"[^>]*?)(/?)>' % rid.group(1))
        if not blip.search(doc):
            continue
        doc = blip.sub(
            lambda m: ("<a:blip%s>%s</a:blip>" % (m.group(1), ext)) if m.group(2)
            else ("<a:blip%s>%s" % (m.group(1), ext)),
            doc,
        )
        items["word/" + svg_name] = svg_path.read_bytes()
        rels = rels.replace(
            "</Relationships>",
            '<Relationship Id="%s" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            'Target="%s"/></Relationships>' % (svg_rid, svg_name),
        )
        attached.append(svg_path.stem)

    if not attached:
        return

    ct = items["[Content_Types].xml"].decode()
    if 'Extension="svg"' not in ct:
        ct = ct.replace(
            "</Types>",
            '<Default Extension="svg" ContentType="image/svg+xml"/></Types>')
    items["[Content_Types].xml"] = ct.encode()
    items["word/_rels/document.xml.rels"] = rels.encode()
    items["word/document.xml"] = doc.encode()

    tmp = docx.with_suffix(".svgblip.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for name, blob in items.items():
            z.writestr(name, blob)
    shutil.move(str(tmp), str(docx))
    print("Vector: SVG attached to %d figure(s)" % len(attached))


def parse_metadata(project_dir: Path) -> dict:
    meta = {
        "title": "", "short_title": "", "author": "", "date": "",
        "acknowledgements": "", "author_acks": [],
        "csl": "", "bibliography": "", "journal_cite": "",
    }
    aw = project_dir / ".planning" / "ACTIVE_WORKFLOW.md"
    if aw.exists():
        content = aw.read_text()
        for line in content.splitlines():
            if line.startswith("title:"):
                meta["title"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("short_title:"):
                meta["short_title"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("journal_cite:"):
                meta["journal_cite"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("author:"):
                meta["author"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("date:"):
                meta["date"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("acknowledgements:"):
                meta["acknowledgements"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("csl:"):
                meta["csl"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("bibliography:"):
                meta["bibliography"] = line.split(":", 1)[1].strip().strip('"')
            elif re.match(r'^author_ack_\d+:', line):
                idx = int(line.split(":", 1)[0].split("_")[-1]) - 1
                val = line.split(":", 1)[1].strip().strip('"')
                while len(meta["author_acks"]) <= idx:
                    meta["author_acks"].append("")
                meta["author_acks"][idx] = val

    precis = project_dir / ".planning" / "PRECIS.md"
    if precis.exists() and not meta["title"]:
        content = precis.read_text()
        m = re.search(r'^#\s+(?:Precis:\s*)?(.+)', content, re.MULTILINE)
        if m:
            meta["title"] = m.group(1).strip()

    outline = project_dir / ".planning" / "OUTLINE.md"
    if outline.exists() and not meta["title"]:
        content = outline.read_text()
        m = re.search(r'^#\s+(?:Outline:\s*)?(.+)', content, re.MULTILINE)
        if m:
            meta["title"] = m.group(1).strip()

    if not meta["title"]:
        meta["title"] = "Untitled"

    if not meta["short_title"]:
        meta["short_title"] = meta["title"]

    # No LOREM placeholder acknowledgement. A star (*) author footnote is emitted ONLY when the
    # author actually sets `acknowledgements:` or `author_ack_N:`. Auto-filling a placeholder created
    # a spurious `*` author footnote on bio-less papers that collided with the real numbered notes
    # (the reported bug: fn 1 shows `*`). Leave acknowledgements empty when unset → no injection.

    if not meta["date"]:
        from datetime import date
        meta["date"] = date.today().strftime("%B %Y")
    return meta


_AUTHOR_SYMBOLS = ['*', '†', '‡', '§', '¶', '#']
_SYMBOL_XML = {
    '*': '<w:sym w:font="Symbol" w:char="F02A"/>',
    '†': '<w:t xml:space="preserve">†</w:t>',
    '‡': '<w:t xml:space="preserve">‡</w:t>',
    '§': '<w:t xml:space="preserve">§</w:t>',
    '¶': '<w:t xml:space="preserve">¶</w:t>',
    '#': '<w:t xml:space="preserve">#</w:t>',
}


def inject_acknowledgement(docx_path: Path, ack_text: str, author_acks: list = None) -> None:
    """Inject per-author acknowledgement footnotes.

    If `author_acks` is provided, split the Author paragraph at each
    law-review symbol (*, †, ‡, §, ...) in the author string and insert a
    footnote reference in place of each symbol. The Nth symbol is tied to
    `author_acks[N-1]`.

    Fallback: if `author_acks` is empty, append a single `*` footnote with
    `ack_text` to the end of the Author paragraph (legacy behavior).
    """
    import zipfile, shutil, html
    from xml.sax.saxutils import escape
    with zipfile.ZipFile(docx_path, 'r') as z:
        contents = {n: z.read(n) for n in z.namelist()}

    doc = contents['word/document.xml'].decode('utf-8')
    fn = contents['word/footnotes.xml'].decode('utf-8')

    used_ids = set(int(x) for x in re.findall(r'w:id="(-?\d+)"', fn + doc))

    def next_id():
        nid = 2
        while nid in used_ids:
            nid += 1
        used_ids.add(nid)
        return nid

    author_pat = re.compile(
        r'(<w:p>\s*<w:pPr>\s*<w:pStyle w:val="Author"\s*/>\s*</w:pPr>)'
        r'(.*?)'
        r'(\s*</w:p>)',
        re.DOTALL,
    )
    m = author_pat.search(doc)
    if not m:
        print('WARN: Author paragraph not found; skipping acknowledgement injection', file=sys.stderr)
        return

    inner = m.group(2)
    text_pat = re.compile(r'<w:t(?:\s[^>]*)?>([^<]*)</w:t>')
    text_m = text_pat.search(inner)
    if not text_m:
        print('WARN: Author text run not found', file=sys.stderr)
        return

    author_text = html.unescape(text_m.group(1))
    footnotes_xml = ''
    filtered_acks = [a for a in (author_acks or []) if a]

    # No per-author acks AND no acknowledgement text → inject NOTHING. Otherwise the legacy
    # single-star fallback stamps an empty `*` author footnote onto a paper that has no bios,
    # which then collides with the real numbered footnotes (the bug: fn 1 shows `*`).
    if not filtered_acks and not (ack_text or '').strip():
        print('INFO: no author acknowledgements; skipping author bio footnote injection')
        return

    if filtered_acks:
        # Split author_text on each recognized symbol in order of appearance
        runs = []
        buf = ''
        symbol_idx = 0
        for ch in author_text:
            if ch in _AUTHOR_SYMBOLS and symbol_idx < len(filtered_acks):
                if buf:
                    runs.append(('text', buf))
                    buf = ''
                runs.append(('symbol', ch, filtered_acks[symbol_idx]))
                symbol_idx += 1
            else:
                buf += ch
        if buf:
            runs.append(('text', buf))

        new_runs_xml = ''
        for run in runs:
            if run[0] == 'text':
                new_runs_xml += (
                    f'<w:r><w:t xml:space="preserve">{escape(run[1])}</w:t></w:r>'
                )
            else:
                _, sym_char, ack_text_i = run
                nid = next_id()
                sym_xml = _SYMBOL_XML.get(sym_char, f'<w:t>{escape(sym_char)}</w:t>')
                new_runs_xml += (
                    f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                    f'<w:footnoteReference w:customMarkFollows="1" w:id="{nid}"/>'
                    f'{sym_xml}</w:r>'
                )
                footnotes_xml += (
                    f'<w:footnote w:id="{nid}">'
                    f'<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
                    f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                    f'{sym_xml}</w:r>'
                    f'<w:r><w:t xml:space="preserve"> {escape(ack_text_i)}</w:t></w:r>'
                    f'</w:p></w:footnote>'
                )

        new_inner = new_runs_xml
        new_doc = doc[:m.start()] + m.group(1) + new_inner + m.group(3) + doc[m.end():]
    else:
        # Legacy single-star fallback
        nid = next_id()
        sym_xml = _SYMBOL_XML['*']
        ref_xml = (
            f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
            f'<w:footnoteReference w:customMarkFollows="1" w:id="{nid}"/>'
            f'{sym_xml}</w:r>'
        )
        new_doc = doc[:m.start()] + m.group(1) + inner + ref_xml + m.group(3) + doc[m.end():]
        footnotes_xml = (
            f'<w:footnote w:id="{nid}">'
            f'<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
            f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
            f'{sym_xml}</w:r>'
            f'<w:r><w:t xml:space="preserve"> {escape(ack_text)}</w:t></w:r>'
            f'</w:p></w:footnote>'
        )

    new_fn = fn.replace('</w:footnotes>', footnotes_xml + '</w:footnotes>')

    contents['word/document.xml'] = new_doc.encode('utf-8')
    contents['word/footnotes.xml'] = new_fn.encode('utf-8')

    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


_TOC_INSTR = ' TOC \\o "1-3" \\h \\z \\u '


def _extract_headings(doc: str) -> list:
    """Walk document.xml and extract (level, text, anchor) for each Heading1-3.

    Returns a list of (level:int, text:str, anchor:str-or-None) tuples in
    document order. Anchor is the bookmark name if one precedes the paragraph.
    """
    import xml.etree.ElementTree as ET
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    try:
        root = ET.fromstring(doc)
    except ET.ParseError:
        return []
    body = root.find('w:body', ns)
    if body is None:
        return []
    style_to_level = {'Heading1': 1, 'Heading2': 2, 'Heading3': 3}
    headings = []
    pending_anchor = None
    for el in body:
        tag = el.tag.split('}', 1)[-1]
        if tag == 'bookmarkStart':
            name = el.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}name')
            if name and not name.startswith('_'):
                pending_anchor = name
            continue
        if tag != 'p':
            pending_anchor = None
            continue
        pPr = el.find('w:pPr', ns)
        if pPr is None:
            pending_anchor = None
            continue
        pStyle = pPr.find('w:pStyle', ns)
        if pStyle is None:
            continue
        sid = pStyle.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
        lvl = style_to_level.get(sid)
        if not lvl:
            pending_anchor = None
            continue
        # Collect paragraph text across all w:t descendants
        text = ''.join(t.text or '' for t in el.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
        text = text.strip()
        if not text:
            continue
        # Anchor: prefer preceding bookmarkStart; otherwise fall back to any
        # bookmarkStart inside the paragraph (pandoc may nest them).
        anchor = pending_anchor
        if not anchor:
            inner_bm = el.find('.//w:bookmarkStart', ns)
            if inner_bm is not None:
                name = inner_bm.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}name')
                if name and not name.startswith('_'):
                    anchor = name
        headings.append((lvl, text, anchor))
        pending_anchor = None
    return headings


def _toc_body_xml(headings: list) -> str:
    """Render the cached TOC body (paragraphs shown before Word updates the field)."""
    from xml.sax.saxutils import escape
    paras = []
    for level, text, anchor in headings:
        style = f'TOC{level}'
        indent_xml = ''
        # Hyperlink the entry when we have an anchor.
        text_x = escape(text)
        link_open = f'<w:hyperlink w:anchor="{escape(anchor)}" w:history="1">' if anchor else ''
        link_close = '</w:hyperlink>' if anchor else ''
        run_rPr = '<w:rPr><w:rStyle w:val="Hyperlink"/><w:noProof/></w:rPr>' if anchor else '<w:rPr><w:noProof/></w:rPr>'
        paras.append(
            f'<w:p><w:pPr><w:pStyle w:val="{style}"/>'
            '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8630"/></w:tabs>'
            f'</w:pPr>{link_open}'
            f'<w:r>{run_rPr}<w:t xml:space="preserve">{text_x}</w:t></w:r>'
            f'{link_close}</w:p>'
        )
    if not paras:
        paras.append(
            '<w:p><w:r><w:t xml:space="preserve">(Table of Contents will appear after Word updates the field.)</w:t></w:r></w:p>'
        )
    return ''.join(paras)


def inject_toc(docx_path: Path) -> None:
    """Insert a dynamic Word TOC before the first Heading 1.

    Generates a pre-populated TOC body (paragraphs styled TOC1/TOC2/TOC3 with
    hyperlinks to bookmarks) wrapped in a TOC field, so the contents appear
    immediately on open and stay updatable via right-click > Update Field.
    """
    import zipfile, shutil
    with zipfile.ZipFile(docx_path, 'r') as z:
        contents = {n: z.read(n) for n in z.namelist()}

    doc = contents['word/document.xml'].decode('utf-8')
    h1_pat = re.compile(r'<w:pStyle\s+w:val="Heading1"\s*/>')
    m = h1_pat.search(doc)
    if not m:
        print('WARN: no Heading1 found; skipping TOC injection', file=sys.stderr)
        return
    p_start = doc.rfind('<w:p ', 0, m.start())
    if p_start == -1:
        p_start = doc.rfind('<w:p>', 0, m.start())
    if p_start == -1:
        print('WARN: could not locate paragraph wrapping first Heading1; skipping TOC injection', file=sys.stderr)
        return

    headings = _extract_headings(doc)
    body_xml = _toc_body_xml(headings)

    # Heading matches OPV law-review format: centered, small caps,
    # default size (no bold), "Table of Contents".
    toc_xml = (
        '<w:p><w:pPr>'
        '<w:tabs><w:tab w:val="right" w:pos="8630"/></w:tabs>'
        '<w:spacing w:line="276" w:lineRule="auto"/>'
        '<w:jc w:val="center"/>'
        '<w:rPr><w:smallCaps/><w:color w:val="000000"/></w:rPr>'
        '</w:pPr>'
        '<w:r><w:rPr><w:smallCaps/><w:color w:val="000000"/></w:rPr>'
        '<w:t>Table of Contents</w:t></w:r></w:p>'
        '<w:p>'
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        f'<w:r><w:instrText xml:space="preserve">{_TOC_INSTR}</w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        '</w:p>'
        f'{body_xml}'
        '<w:p>'
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
        '</w:p>'
        '<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>'
    )
    new_doc = doc[:p_start] + toc_xml + doc[p_start:]
    contents['word/document.xml'] = new_doc.encode('utf-8')

    # Note: we deliberately do NOT set w:updateFields on settings.xml. Setting
    # it to true makes Word prompt "Update the table of contents?" every time
    # the document opens, which breaks the headless build→PDF loop via
    # osascript. The TOC body we injected above is already current at build
    # time, so users who open the DOCX see the correct TOC immediately.
    # Anyone who edits the document and wants to refresh can right-click the
    # TOC and choose Update Field.

    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


def normalize_abstract_heading(docx_path: Path) -> None:
    """Replace the template's AbstractHeading paragraph with OPV-style direct formatting.

    OPV law-review convention: "Abstract" heading is centered, bold italic, default
    size, line spacing 276 auto — no paragraph style assigned.
    """
    import zipfile, shutil
    with zipfile.ZipFile(docx_path, 'r') as z:
        contents = {n: z.read(n) for n in z.namelist()}

    doc = contents['word/document.xml'].decode('utf-8')
    pat = re.compile(
        r'<w:p>\s*<w:pPr>\s*<w:pStyle\s+w:val="AbstractHeading"\s*/>\s*</w:pPr>'
        r'\s*<w:r>\s*<w:t(?:\s[^>]*)?>Abstract</w:t>\s*</w:r>\s*</w:p>',
    )
    replacement = (
        '<w:p><w:pPr>'
        '<w:spacing w:line="276" w:lineRule="auto"/>'
        '<w:jc w:val="center"/>'
        '<w:rPr><w:b/><w:bCs/><w:i/><w:iCs/></w:rPr>'
        '</w:pPr>'
        '<w:r><w:rPr><w:b/><w:bCs/><w:i/><w:iCs/></w:rPr>'
        '<w:t>Abstract</w:t></w:r></w:p>'
    )
    new_doc, n = pat.subn(replacement, doc, count=1)
    if n == 0:
        print('WARN: AbstractHeading paragraph not found; skipping abstract-heading normalization', file=sys.stderr)
        return
    contents['word/document.xml'] = new_doc.encode('utf-8')

    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


def replace_header_placeholders(docx_path: Path, short_title: str,
                                journal_cite: str = "") -> None:
    """Fill running-header placeholders in every header part.

    {{SHORT_TITLE}} -> short title (recto running head)
    {{JOURNAL_CITE}} -> journal citation, e.g. "115 Geo. L.J. ___ (2026)"
                        (centered, every page incl. the title page)

    An unset journal_cite collapses to empty so the header degrades to the
    short title alone rather than showing a literal placeholder.
    """
    import zipfile, shutil
    with zipfile.ZipFile(docx_path, 'r') as z:
        names = z.namelist()
        contents = {n: z.read(n) for n in names}
    replaced = False
    for name in list(contents):
        if name.startswith('word/header') and name.endswith('.xml'):
            text = contents[name].decode('utf-8')
            new = (text.replace('{{SHORT_TITLE}}', short_title)
                       .replace('{{JOURNAL_CITE}}', journal_cite))
            if new != text:
                contents[name] = new.encode('utf-8')
                replaced = True
    if not replaced:
        return
    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


def convert_to_pdf(docx_path: Path) -> Optional[Path]:
    """Convert DOCX to PDF. Prefers Microsoft Word on macOS (line-exact layout
    for widow detection and faithful tables), then ONLYOFFICE x2t (OOXML-native;
    renders footnote numRestart correctly where LibreOffice does not), then
    LibreOffice headless as last resort.

    Word rendering is delegated to ``doc_render.convert(renderer="word")``,
    which drives Word directly from a foreground/granted GUI session and, from a
    detached/background job (where direct AppleEvents fail with -600), transparently
    dispatches the render into a cmux pane that lives in the console GUI session.
    See scripts/doc_render.py and docs/investigations/2026-06-22_word-render-cmux-dispatch.md.
    """
    import sys as _sys
    out = docx_path.parent / (docx_path.stem + ".pdf")
    _sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
    from doc_render import convert as _convert, find_word
    try:
        if _sys.platform == "darwin" and find_word():
            # auto + allow_word = "prefer Word, but accept the x2t/LibreOffice
            # fallback if Word can't render." (An EXPLICIT renderer="word" is now
            # strict — it raises instead of falling back — which is right for the
            # CLI but wrong here, where the build just needs *a* PDF.)
            return _convert(docx_path, out, renderer="auto", allow_word=True)
        # Word unavailable (not macOS, or Word not installed) — falls back to
        # the non-Word auto path (x2t/LibreOffice). This contradicts the
        # docx-render Iron Law ("--renderer word for deliverables": Word is the
        # only faithful-layout renderer), so make the fallback loud instead of
        # silent — the caller must know to re-render before submission.
        print("WARNING: Word unavailable — PDF rendered via x2t/LibreOffice, "
              "layout may reflow; re-render with --renderer word before submission",
              file=sys.stderr)
        return _convert(docx_path, out)
    except Exception as e:
        print(f"WARN: PDF conversion failed: {e}", file=sys.stderr)
        return None


def force_widow_control(docx_path: Path) -> None:
    """Insert <w:widowControl/> into every paragraph's pPr in document.xml and
    footnotes.xml. Word's page-level widow/orphan control only activates when
    the property is present on the paragraph (document-default isn't always
    respected for pandoc-emitted paragraphs). This forces it everywhere so
    Word pulls a second line forward rather than stranding a single line at
    the top of a page.
    """
    import zipfile, shutil
    with zipfile.ZipFile(docx_path, 'r') as z:
        contents = {n: z.read(n) for n in z.namelist()}

    # Pattern: find every <w:pPr>...</w:pPr> that lacks <w:widowControl; add it.
    # Also: for <w:p> paragraphs without any <w:pPr>, inject <w:pPr><w:widowControl/></w:pPr>.
    def add_widow_control(xml: str) -> str:
        # Add to existing pPr blocks that don't already have widowControl
        def add_to_pPr(m: re.Match) -> str:
            block = m.group(0)
            if 'widowControl' in block:
                return block
            # insert right after the opening <w:pPr> tag
            return re.sub(r'(<w:pPr(?:\s+[^>]*)?>)', r'\1<w:widowControl/>', block, count=1)
        xml = re.sub(r'<w:pPr(?:\s+[^>]*)?>.*?</w:pPr>', add_to_pPr, xml, flags=re.DOTALL)
        # For paragraphs without pPr, inject one
        xml = re.sub(
            r'<w:p(\s+[^>]*)?>(\s*<w:r)',
            lambda m: f'<w:p{m.group(1) or ""}><w:pPr><w:widowControl/></w:pPr>{m.group(2)}',
            xml,
        )
        return xml

    for key in ('word/document.xml', 'word/footnotes.xml'):
        if key in contents:
            xml = contents[key].decode('utf-8')
            contents[key] = add_widow_control(xml).encode('utf-8')

    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


# ---------------------------------------------------------------------------
# great_tables / booktabs table styling (post-build pass)
# ---------------------------------------------------------------------------
#
# pandoc emits tables with equal-width columns, full grid borders, and no
# real style. This pass restyles every native Word table to mimic the
# great_tables (booktabs) look the law-review draft targets, and — crucially —
# makes that styling durable: it runs on every build, so manual docx fixes
# that would otherwise be wiped no longer have to be made by hand.
#
# Per table it:
#   - content-fits column widths (body label cells sized to the full phrase so
#     multi-word labels stay on one line; headers sized to the longest WORD so
#     multi-word headers may wrap; every column floored at its longest token so
#     numbers/words never split mid-token);
#   - centers the table (tblPr jc=center, fixed layout);
#   - applies booktabs borders (table top+bottom rule, header-row midrule, no
#     interior/vertical rules) and removes cell shading;
#   - bolds the header row, right-aligns numeric columns (auto-detected),
#     left-aligns text columns;
#   - adds cell padding, marks rows cantSplit, and gives the caption keepNext;
#   - if a table's natural width exceeds the usable text width, shrinks THAT
#     table's font (floor 8pt) and scales widths by the same factor so nothing
#     wraps;
#   - for tables too wide to fit even at 8pt portrait, moves the table onto its
#     own LANDSCAPE section with the caption and trailing Note travelling with
#     it (no stranded caption/note, no blank portrait page around it).
#
# Standard PostScript Times-Roman advance widths (per 1000 em). Used to
# estimate rendered text width without a font-metrics dependency. The law
# review body font is a Times clone, so these track Word's layout closely
# enough for content-fitting.
_TIMES_ROMAN_W = {
    ' ': 250, '!': 333, '"': 408, '#': 500, '$': 500, '%': 833, '&': 778,
    "'": 180, '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333,
    '.': 250, '/': 278, '0': 500, '1': 500, '2': 500, '3': 500, '4': 500,
    '5': 500, '6': 500, '7': 500, '8': 500, '9': 500, ':': 278, ';': 278,
    '<': 564, '=': 564, '>': 564, '?': 444, '@': 921, 'A': 722, 'B': 667,
    'C': 667, 'D': 722, 'E': 611, 'F': 556, 'G': 722, 'H': 722, 'I': 333,
    'J': 389, 'K': 722, 'L': 611, 'M': 889, 'N': 722, 'O': 722, 'P': 556,
    'Q': 722, 'R': 667, 'S': 556, 'T': 611, 'U': 722, 'V': 722, 'W': 944,
    'X': 722, 'Y': 722, 'Z': 611, '[': 333, '\\': 278, ']': 333, '^': 469,
    '_': 500, '`': 333, 'a': 444, 'b': 500, 'c': 444, 'd': 500, 'e': 444,
    'f': 333, 'g': 500, 'h': 500, 'i': 278, 'j': 278, 'k': 500, 'l': 278,
    'm': 778, 'n': 500, 'o': 500, 'p': 500, 'q': 500, 'r': 333, 's': 389,
    't': 278, 'u': 500, 'v': 500, 'w': 722, 'x': 500, 'y': 500, 'z': 444,
    '{': 480, '|': 200, '}': 480, '~': 541,
    # common unicode the drafts use
    '–': 500, '—': 1000, '‘': 333, '’': 333,
    '“': 444, '”': 444, '…': 1000, '×': 564, '−': 564,
}
_TIMES_DEFAULT_W = 500
# Bold runs render a little wider than the regular metrics; pad header-derived
# widths so bolded header words don't wrap unexpectedly.
_BOLD_FACTOR = 1.14
# General slack on every estimated width. The body font is a Times clone but
# not exactly Times, and Word rounds column widths; a few percent of headroom
# guarantees the longest token never splits at the column boundary.
_WIDTH_SLACK = 1.06
_FONT_FLOOR_PT = 8.0
# Cell padding (twips) added inside every column width.
_CELL_MAR_LR = 100  # left + right each
_CELL_MAR_TB = 40   # top + bottom each


def _text_twips(s: str, font_pt: float) -> float:
    """Approximate rendered width of `s` in twips at `font_pt` (Times-Roman)."""
    units = sum(_TIMES_ROMAN_W.get(c, _TIMES_DEFAULT_W) for c in s)
    return units / 1000.0 * font_pt * 20.0


def style_tables(docx_path: Path, width_factor: float = 1.0) -> None:
    """Restyle every native Word table to the great_tables (booktabs) look.

    Idempotent: re-running on an already-styled document reproduces the same
    result (borders/shading/alignment/widths are overwritten, not appended;
    cantSplit/keepNext/sectPr insertions are guarded against duplication).

    ``width_factor`` scales the Times-Roman width model in ``_text_twips`` for
    documents set in a wider face. The law-review template is a Times clone, so
    1.0 is right there; Latin Modern Roman (the law-econ template) runs ~15%
    wider and needs ~1.15, or column widths come out short and Word splits
    words mid-token.
    """
    import zipfile, shutil

    def tw(s: str, font_pt: float) -> float:
        return _text_twips(s, font_pt) * width_factor
    import xml.etree.ElementTree as ET

    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    ns = f"{{{W}}}"

    with zipfile.ZipFile(docx_path, 'r') as z:
        contents = {n: z.read(n) for n in z.namelist()}
    raw = contents['word/document.xml'].decode('utf-8')

    # Register EVERY namespace declared anywhere in the document so ET round-trips
    # prefixes (w, r, m, a, pic, wp, ...) verbatim — otherwise r:id / drawing
    # references for figures get rewritten to ns0: and break.
    for prefix, uri in re.findall(r'xmlns:(\w+)="([^"]+)"', raw):
        try:
            ET.register_namespace(prefix, uri)
        except ValueError:
            pass

    root = ET.fromstring(raw)
    body = root.find(f"{ns}body")
    if body is None:
        return

    def el(tag, **a):
        e = ET.Element(f"{ns}{tag}")
        for k, v in a.items():
            e.set(f"{ns}{k}", str(v))
        return e

    def border(tag, val, sz):
        return el(tag, val=val, sz=sz, space=0, color="000000")

    def ctext(tc):
        # Document-order text; treat line/page breaks and tabs as whitespace so
        # words split correctly even after wrap_cell has inserted <w:br/> between
        # them (otherwise "All"+"completed" would read as one token "Allcompleted"
        # -- breaking width sizing and idempotency on re-runs).
        out = []
        for node in tc.iter():
            if node.tag == f"{ns}t":
                out.append(node.text or "")
            elif node.tag in (f"{ns}br", f"{ns}cr", f"{ns}tab"):
                out.append(" ")
        return "".join(out).strip()

    NUM = re.compile(r'^[\(\-–]?[\d,]+\.?\d*%?\)?$|^[–-]$|^\$')

    def is_num(s):
        s = s.strip()
        return bool(s) and bool(NUM.match(s))

    def get_or_make(parent, child_tag, index=0):
        c = parent.find(f"{ns}{child_tag}")
        if c is None:
            c = ET.Element(f"{ns}{child_tag}")
            parent.insert(index, c)
        return c

    def set_align(tc, val):
        for p in tc.findall(f"{ns}p"):
            pPr = get_or_make(p, "pPr")
            jc = pPr.find(f"{ns}jc")
            if jc is None:
                jc = ET.SubElement(pPr, f"{ns}jc")
            jc.set(f"{ns}val", val)

    def set_run_font(tc, half_pt, bold):
        for r in tc.iter(f"{ns}r"):
            rPr = r.find(f"{ns}rPr")
            if rPr is None:
                rPr = ET.Element(f"{ns}rPr")
                r.insert(0, rPr)
            for tag in ("sz", "szCs"):
                e = rPr.find(f"{ns}{tag}")
                if e is None:
                    e = ET.SubElement(rPr, f"{ns}{tag}")
                e.set(f"{ns}val", str(half_pt))
            if bold and rPr.find(f"{ns}b") is None:
                rPr.append(el("b"))

    import copy as _copy

    def wrap_cell(tc, text_area, font_pt, bold):
        """Insert explicit ``<w:br/>`` at greedy wrap points so the cell never
        relies on auto-wrap. LibreOffice-headless collapses the WHOLE table to a
        single stacked column when any cell's content is wider than its column
        (Word/x2t wrap fine); pre-breaking the text keeps soffice rendering the
        grid. Idempotent: flattens any prior breaks and re-wraps identically.
        Only the simple single-paragraph cell is touched. See
        docs/investigations/2026-06-19_x2t-kerning-patch.md (BUG 1)."""
        ps = tc.findall(f"{ns}p")
        if len(ps) != 1 or text_area <= 0:
            return
        p = ps[0]
        words = ctext(tc).split()  # break-aware: re-flattens prior wraps
        if not words:
            return
        bf = _BOLD_FACTOR if bold else 1.0
        lines, cur = [], []
        for w in words:
            if cur and tw(" ".join(cur + [w]), font_pt) * bf > text_area:
                lines.append(" ".join(cur))
                cur = [w]
            else:
                cur.append(w)
        if cur:
            lines.append(" ".join(cur))
        # representative rPr (post set_run_font) to clone onto the rebuilt runs
        sample = None
        for r in p.findall(f"{ns}r"):
            if r.find(f"{ns}rPr") is not None:
                sample = r.find(f"{ns}rPr")
                break
        for child in list(p):           # keep pPr, drop all runs/breaks
            if child.tag != f"{ns}pPr":
                p.remove(child)
        for i, line in enumerate(lines):
            if i > 0:                   # explicit line break between lines
                br = ET.SubElement(p, f"{ns}r")
                ET.SubElement(br, f"{ns}br")
            r = ET.SubElement(p, f"{ns}r")
            if sample is not None:
                r.append(_copy.deepcopy(sample))
            t = ET.SubElement(r, f"{ns}t")
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
            t.text = line

    # --- usable text width from the body's final sectPr -------------------
    final_sect = None
    for ch in list(body):
        if ch.tag == f"{ns}sectPr":
            final_sect = ch
    pg_w, marg_l, marg_r = 12240, 1800, 1800
    if final_sect is not None:
        pgsz = final_sect.find(f"{ns}pgSz")
        if pgsz is not None:
            pg_w = int(pgsz.get(f"{ns}w", pg_w))
            pg_h = int(pgsz.get(f"{ns}h", 15840))
            # Normalize to PORTRAIT base dims. A previous run may have rotated the
            # body-final sectPr to landscape (end-of-doc landscape table); without
            # this, re-runs would read the rotated dims and mis-size everything.
            if pgsz.get(f"{ns}orient") == "landscape" or pg_w > pg_h:
                pg_w, pg_h = min(pg_w, pg_h), max(pg_w, pg_h)
        else:
            pg_h = 15840
        pgmar = final_sect.find(f"{ns}pgMar")
        if pgmar is not None:
            marg_l = int(pgmar.get(f"{ns}left", marg_l))
            marg_r = int(pgmar.get(f"{ns}right", marg_r))
    else:
        pg_h = 15840
    usable_portrait = pg_w - marg_l - marg_r
    usable_landscape = pg_h - marg_l - marg_r  # rotated: portrait height becomes width

    base_half = _doc_default_half(contents.get('word/styles.xml', b'').decode('utf-8', 'ignore'))
    base_pt = base_half / 2.0

    tables = list(body.iter(f"{ns}tbl"))
    landscape_tables = []  # (tbl_element,) needing landscape section

    for t in tables:
        grid = t.find(f"{ns}tblGrid")
        if grid is None:
            continue
        gridcols = grid.findall(f"{ns}gridCol")
        ncol = len(gridcols)
        if ncol == 0:
            continue
        rows = t.findall(f"{ns}tr")
        if not rows:
            continue

        # Base font is ALWAYS the document default — never an explicit run size,
        # which on a re-run would be the size WE applied (compounding shrink and
        # breaking idempotency). pandoc never emits w:sz on table runs, so the
        # default is the true starting point.
        tbl_base_half = base_half
        tbl_base_pt = tbl_base_half / 2.0

        # --- content-fit column widths (in twips, at base font) -----------
        content_w = [0.0] * ncol
        min_w = tw("00", tbl_base_pt)
        for ri, tr in enumerate(rows):
            pos = 0
            for tc in tr.findall(f"{ns}tc"):
                tcPr = tc.find(f"{ns}tcPr")
                gs = tcPr.find(f"{ns}gridSpan") if tcPr is not None else None
                span = int(gs.get(f"{ns}val")) if gs is not None else 1
                text = ctext(tc)
                if span == 1 and pos < ncol:
                    is_header = (ri == 0)
                    pad = _BOLD_FACTOR if is_header else 1.0
                    # floor: longest single token never splits
                    for tok in text.split():
                        content_w[pos] = max(content_w[pos], tw(tok, tbl_base_pt) * pad)
                    # body label cells: keep the full phrase on one line
                    if not is_header and text:
                        content_w[pos] = max(content_w[pos], tw(text, tbl_base_pt))
                pos += span
        content_w = [max(w * _WIDTH_SLACK, min_w) for w in content_w]
        sum_content = sum(content_w)
        margins_total = ncol * (2 * _CELL_MAR_LR)

        # --- fit to usable width; shrink font + scale widths if needed ----
        def fit_ratio(avail):
            if sum_content <= 0:
                return 1.0
            return (avail - margins_total) / sum_content

        orient = "portrait"
        ratio = 1.0
        natural_total = sum_content + margins_total
        if natural_total <= usable_portrait:
            ratio = 1.0
        else:
            r_p = fit_ratio(usable_portrait)
            if tbl_base_pt * r_p >= _FONT_FLOOR_PT:
                ratio = r_p
            else:
                orient = "landscape"
                r_l = fit_ratio(usable_landscape)
                if r_l >= 1.0:
                    ratio = 1.0
                elif tbl_base_pt * r_l >= _FONT_FLOOR_PT:
                    ratio = r_l
                else:
                    # floor font at 8pt; size widths to the content at 8pt so
                    # nothing wraps (table may marginally overflow, but the
                    # alternative is split tokens).
                    ratio = _FONT_FLOOR_PT / tbl_base_pt
        font_pt = max(_FONT_FLOOR_PT, tbl_base_pt * ratio)
        half_pt = max(int(round(_FONT_FLOOR_PT * 2)), int(round(font_pt * 2)))

        final_total = [int(round(content_w[c] * ratio)) + 2 * _CELL_MAR_LR for c in range(ncol)]
        tbl_total = sum(final_total)

        # --- tblPr: width, centering, fixed layout, borders, padding ------
        tblPr = get_or_make(t, "tblPr", 0)
        # Drop pandoc's tblStyle reference (it points at a "Table" style absent
        # from this template; a missing/grid style can reintroduce borders) and
        # neutralize conditional formatting so only our explicit borders show.
        for e in tblPr.findall(f"{ns}tblStyle"):
            tblPr.remove(e)
        for e in tblPr.findall(f"{ns}tblLook"):
            tblPr.remove(e)
        # tblW
        for e in tblPr.findall(f"{ns}tblW"):
            tblPr.remove(e)
        tblPr.append(el("tblW", w=tbl_total, type="dxa"))
        # jc center (remove + re-append so element order is a fixed point)
        for e in tblPr.findall(f"{ns}jc"):
            tblPr.remove(e)
        tblPr.append(el("jc", val="center"))
        # small indent matching the GT target
        for e in tblPr.findall(f"{ns}tblInd"):
            tblPr.remove(e)
        tblPr.append(el("tblInd", w=108, type="dxa"))
        # fixed layout so our widths are honoured
        for e in tblPr.findall(f"{ns}tblLayout"):
            tblPr.remove(e)
        tblPr.append(el("tblLayout", type="fixed"))
        # booktabs borders: outer top+bottom only
        for e in tblPr.findall(f"{ns}tblBorders"):
            tblPr.remove(e)
        tb = el("tblBorders")
        tb.append(border("top", "single", 8))
        tb.append(border("bottom", "single", 8))
        for z in ("left", "right", "insideH", "insideV"):
            tb.append(el(z, val="nil"))
        tblPr.append(tb)
        # cell padding
        for e in tblPr.findall(f"{ns}tblCellMar"):
            tblPr.remove(e)
        cm = el("tblCellMar")
        cm.append(el("top", w=_CELL_MAR_TB, type="dxa"))
        cm.append(el("bottom", w=_CELL_MAR_TB, type="dxa"))
        cm.append(el("left", w=_CELL_MAR_LR, type="dxa"))
        cm.append(el("right", w=_CELL_MAR_LR, type="dxa"))
        tblPr.append(cm)

        # --- tblGrid widths ----------------------------------------------
        for c, gc in enumerate(gridcols):
            gc.set(f"{ns}w", str(final_total[c]))

        # --- numeric column detection (>=60% of body cells numeric) -------
        numeric = [0] * ncol
        total = [0] * ncol
        for tr in rows[1:]:
            pos = 0
            for tc in tr.findall(f"{ns}tc"):
                tcPr = tc.find(f"{ns}tcPr")
                gs = tcPr.find(f"{ns}gridSpan") if tcPr is not None else None
                span = int(gs.get(f"{ns}val")) if gs is not None else 1
                if span == 1 and pos < ncol:
                    s = ctext(tc)
                    if s:
                        total[pos] += 1
                        numeric[pos] += 1 if is_num(s) else 0
                pos += span
        col_is_num = [total[c] > 0 and numeric[c] / total[c] >= 0.6 for c in range(ncol)]

        # --- per-row / per-cell styling ----------------------------------
        # Booktabs rules are drawn at the CELL level (tcBorders), which override
        # any table style or conditional formatting — the table-level tblBorders
        # alone is not enough because pandoc's tblStyle reference can reintroduce
        # a full grid. top rule on the first row, midrule under the header,
        # bottom rule on the last row; every interior edge nil.
        nrows = len(rows)
        last_row = nrows - 1
        for ri, tr in enumerate(rows):
            trPr = get_or_make(tr, "trPr", 0)
            if trPr.find(f"{ns}cantSplit") is None:
                trPr.append(el("cantSplit"))
            pos = 0
            for tc in tr.findall(f"{ns}tc"):
                tcPr = get_or_make(tc, "tcPr", 0)
                for sh in tcPr.findall(f"{ns}shd"):
                    tcPr.remove(sh)
                gs = tcPr.find(f"{ns}gridSpan")
                span = int(gs.get(f"{ns}val")) if gs is not None else 1
                # cell width = sum of spanned grid columns
                cell_w = sum(final_total[pos:pos + span]) if pos < ncol else final_total[-1]
                for e in tcPr.findall(f"{ns}tcW"):
                    tcPr.remove(e)
                tcPr.append(el("tcW", w=cell_w, type="dxa"))
                col = pos
                # explicit cell borders (booktabs)
                for tcb in tcPr.findall(f"{ns}tcBorders"):
                    tcPr.remove(tcb)
                tcb = el("tcBorders")
                tcb.append(border("top", "single", 8) if ri == 0 else el("top", val="nil"))
                tcb.append(el("left", val="nil"))
                if ri == last_row:
                    tcb.append(border("bottom", "single", 8))
                elif ri == 0:
                    tcb.append(border("bottom", "single", 6))
                else:
                    tcb.append(el("bottom", val="nil"))
                tcb.append(el("right", val="nil"))
                tcb.append(el("insideH", val="nil"))
                tcb.append(el("insideV", val="nil"))
                tcPr.append(tcb)
                align = "right" if (col < ncol and col_is_num[col]) else "left"
                set_align(tc, align)
                set_run_font(tc, half_pt, bold=(ri == 0))
                # Pre-break cell text to its column's text width so nothing
                # auto-wraps (LibreOffice collapses tables that auto-wrap).
                wrap_cell(tc, cell_w - 2 * _CELL_MAR_LR, font_pt, bold=(ri == 0))
                pos += span

        if orient == "landscape":
            landscape_tables.append(t)

    # --- heading keepNext + keepLines (idempotent) ------------------------
    HEADING_STYLES = {"Heading1", "Heading2", "Heading3"}
    for p in body.iter(f"{ns}p"):
        pPr = p.find(f"{ns}pPr")
        if pPr is None:
            continue
        pStyle = pPr.find(f"{ns}pStyle")
        if pStyle is None:
            continue
        if pStyle.get(f"{ns}val") in HEADING_STYLES:
            if pPr.find(f"{ns}keepNext") is None:
                pPr.append(el("keepNext"))
            if pPr.find(f"{ns}keepLines") is None:
                pPr.append(el("keepLines"))

    # --- caption keepNext (paragraph immediately before each table) -------
    def para_text(p):
        return "".join(x.text or "" for x in p.iter(f"{ns}t"))

    def is_caption(p):
        if p.tag != f"{ns}p":
            return False
        pPr = p.find(f"{ns}pPr")
        if pPr is not None:
            ps = pPr.find(f"{ns}pStyle")
            if ps is not None and ps.get(f"{ns}val") in ("TableCaption", "Caption"):
                return True
        return bool(re.match(r'\s*Table\s', para_text(p)))

    children = list(body)
    for idx, ch in enumerate(children):
        if ch.tag == f"{ns}tbl" and idx > 0:
            # nearest preceding paragraph (skip bookmarks)
            j = idx - 1
            while j >= 0 and children[j].tag != f"{ns}p":
                j -= 1
            if j >= 0 and is_caption(children[j]):
                pPr = get_or_make(children[j], "pPr")
                if pPr.find(f"{ns}keepNext") is None:
                    pPr.append(el("keepNext"))

    # --- landscape sections for over-wide tables --------------------------
    def clone_sect(landscape):
        if final_sect is not None:
            sect = ET.fromstring(ET.tostring(final_sect, encoding='unicode'))
        else:
            sect = el("sectPr")
            sect.append(el("type", val="nextPage"))
            sect.append(el("pgSz", w=12240, h=15840))
            sect.append(el("pgMar", top=1440, bottom=1440, left=marg_l, right=marg_r))
        # force a plain next-page break (never even/odd -> avoids blank pages)
        for ty in sect.findall(f"{ns}type"):
            sect.remove(ty)
        sect.insert(0, el("type", val="nextPage"))
        pgsz = sect.find(f"{ns}pgSz")
        if pgsz is None:
            pgsz = ET.SubElement(sect, f"{ns}pgSz")
        if landscape:
            pgsz.set(f"{ns}w", str(pg_h))   # rotate
            pgsz.set(f"{ns}h", str(pg_w))
            pgsz.set(f"{ns}orient", "landscape")
        else:
            pgsz.set(f"{ns}w", str(pg_w))
            pgsz.set(f"{ns}h", str(pg_h))
            if pgsz.get(f"{ns}orient"):
                del pgsz.attrib[f"{ns}orient"]
        return sect

    def add_sectpr_to_para(p, sect):
        pPr = get_or_make(p, "pPr")
        # idempotent: replace any existing sectPr
        for e in pPr.findall(f"{ns}sectPr"):
            pPr.remove(e)
        # sectPr must precede rPr within pPr
        rPr = pPr.find(f"{ns}rPr")
        if rPr is not None:
            pPr.insert(list(pPr).index(rPr), sect)
        else:
            pPr.append(sect)

    def make_landscape(sect):
        """Rotate an existing sectPr to landscape, plain next-page (in place)."""
        for ty in sect.findall(f"{ns}type"):
            sect.remove(ty)
        sect.insert(0, el("type", val="nextPage"))
        pgsz = sect.find(f"{ns}pgSz")
        if pgsz is None:
            pgsz = ET.SubElement(sect, f"{ns}pgSz")
        pgsz.set(f"{ns}w", str(pg_h))
        pgsz.set(f"{ns}h", str(pg_w))
        pgsz.set(f"{ns}orient", "landscape")

    for t in landscape_tables:
        children = list(body)
        try:
            idx = children.index(t)
        except ValueError:
            continue
        # caption = nearest preceding paragraph
        ci = idx - 1
        while ci >= 0 and children[ci].tag != f"{ns}p":
            ci -= 1
        caption = children[ci] if (ci >= 0 and is_caption(children[ci])) else None
        island_start = ci if caption is not None else idx
        caption_el = children[island_start] if caption is not None else None

        # portrait terminator target: nearest paragraph before the island start
        pj = island_start - 1
        while pj >= 0 and children[pj].tag != f"{ns}p":
            pj -= 1
        term_para = children[pj] if pj >= 0 else None

        # trailing Note paragraph(s) immediately after the table
        nj = idx + 1
        note_el = None
        while nj < len(children):
            nxt = children[nj]
            if nxt.tag == f"{ns}p":
                txt = para_text(nxt).strip()
                if re.match(r'(?i)^(note|notes|source|sources)\b', txt):
                    note_el = nxt
                    nj += 1
                    continue
                break
            elif nxt.tag in (f"{ns}bookmarkStart", f"{ns}bookmarkEnd"):
                nj += 1
                continue
            break

        island_end_el = note_el if note_el is not None else t
        island_end_idx = children.index(island_end_el)
        # Is there REAL content after the island (non-empty paragraph or table)?
        # A trailing empty paragraph is NOT content — counting it would strand a
        # blank portrait page after an end-of-document landscape table.
        has_trailing = any(
            children[k].tag == f"{ns}tbl"
            or (children[k].tag == f"{ns}p" and para_text(children[k]).strip())
            for k in range(island_end_idx + 1, len(children))
        )

        # 1) portrait terminator before the caption (always)
        if term_para is not None:
            add_sectpr_to_para(term_para, clone_sect(landscape=False))
        else:
            term = el("p")
            add_sectpr_to_para(term, clone_sect(landscape=False))
            insert_at = list(body).index(caption_el) if caption_el is not None else list(body).index(t)
            body.insert(insert_at, term)

        # 2) close the landscape section
        if has_trailing:
            # real content follows -> end the landscape section on the note (or a
            # new empty paragraph after the table) so the rest stays portrait.
            if note_el is not None:
                add_sectpr_to_para(note_el, clone_sect(landscape=True))
            else:
                land_para = el("p")
                add_sectpr_to_para(land_para, clone_sect(landscape=True))
                body.insert(list(body).index(t) + 1, land_para)
        else:
            # island is the last content in the document -> make the BODY-FINAL
            # sectPr landscape rather than adding a break, so no empty portrait
            # page is stranded after it.
            if note_el is not None:
                npr = note_el.find(f"{ns}pPr")
                if npr is not None:
                    for e in npr.findall(f"{ns}sectPr"):
                        npr.remove(e)
            if final_sect is not None:
                make_landscape(final_sect)
            else:
                body.append(clone_sect(landscape=True))

    # --- normalize child order to the OOXML schema -----------------------
    # Word silently DROPS properties that appear out of canonical order (e.g.
    # tblBorders after tblLayout, or tcW after gridSpan), which is how a full
    # grid leaks back in. Re-sort the children of every properties element we
    # touch into schema order. Unknown tags are pushed to the end, preserving
    # their relative order.
    _ORDERS = {
        "tblPr": ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual",
                  "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc",
                  "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout",
                  "tblCellMar", "tblLook", "tblCaption", "tblDescription"],
        "trPr": ["cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore",
                 "wAfter", "cantSplit", "trHeight", "tblHeader",
                 "tblCellSpacing", "jc", "hidden", "ins", "del", "trPrChange"],
        "tcPr": ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders",
                 "shd", "noWrap", "tcMar", "textDirection", "tcFit", "vAlign",
                 "hideMark"],
        "pPr": ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr",
                "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd",
                "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap",
                "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN",
                "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind",
                "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc",
                "textDirection", "textAlignment", "textboxTightWrap",
                "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
    }

    def reorder(parent, order):
        rank = {t: i for i, t in enumerate(order)}
        kids = list(parent)
        kids.sort(key=lambda e: rank.get(e.tag.split('}')[-1], len(order)))
        for k in kids:
            parent.remove(k)
        for k in kids:
            parent.append(k)

    for tag in ("tblPr", "trPr", "tcPr"):
        for e in body.iter(f"{ns}{tag}"):
            reorder(e, _ORDERS[tag])
    for p in body.iter(f"{ns}p"):
        pPr = p.find(f"{ns}pPr")
        if pPr is not None:
            reorder(pPr, _ORDERS["pPr"])

    new_xml = ET.tostring(root, encoding='unicode')
    if not new_xml.lstrip().startswith('<?xml'):
        new_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new_xml
    contents['word/document.xml'] = new_xml.encode('utf-8')

    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


def _doc_default_half(styles_xml: str) -> int:
    """Document default font size in half-points (e.g. 24 == 12pt)."""
    m = re.search(r'<w:docDefaults>.*?<w:rPrDefault>.*?<w:sz w:val="(\d+)"',
                  styles_xml, re.DOTALL)
    if m:
        return int(m.group(1))
    return 24


def hoist_abstract(md: str) -> str:
    """Move an Abstract custom-style block to front matter.

    The TOC is injected before the first top-level heading (see ``insert_toc``),
    so the abstract must sit before that heading to render in the conventional
    order Title -> Abstract -> Table of Contents -> Introduction. Authors often
    nest the abstract *under* the first ``# Introduction`` heading, which pushes
    it after the TOC. This relocates the block to immediately before the first
    ``# `` heading regardless of where it was drafted. Idempotent; a no-op if no
    abstract block or no heading is present.
    """
    abs_re = re.compile(
        r'::: \{custom-style="Abstract Heading"\}.*?'
        r'::: \{custom-style="Abstract"\}.*?\n:::',
        re.DOTALL,
    )
    m = abs_re.search(md)
    if not m:
        return md
    block = m.group(0).strip()
    rest = md[:m.start()] + md[m.end():]
    h = re.search(r'^# ', rest, re.MULTILINE)
    if not h:
        return md  # no top-level heading to anchor against; leave untouched
    before = rest[:h.start()].rstrip()
    after = rest[h.start():]
    sep = (before + "\n\n") if before else ""
    return sep + block + "\n\n" + after


def build(project_dir: Path, output: Optional[Path] = None, fix_footnotes: bool = True, pdf: bool = False) -> Path:
    drafts = sorted(project_dir.glob("drafts/*Draft*.md"), key=sort_key)
    if not drafts:
        print("ERROR: No draft files found in drafts/", file=sys.stderr)
        sys.exit(1)

    meta = parse_metadata(project_dir)

    combined = f"""---
title: "{meta['title']}"
author: "{meta['author']}"
date: "{meta['date']}"
---

"""

    for draft in drafts:
        prefix = get_prefix(draft)
        text = strip_frontmatter(draft.read_text())
        text = prefix_footnotes(text, prefix)
        combined += text + "\n\n"

    combined = resolve_includes(combined)
    combined = hoist_abstract(combined)
    combined = bluebook_lint(combined)

    for lineno, snippet in find_stacked_footnotes(combined):
        trimmed = snippet.strip()
        if len(trimmed) > 160:
            trimmed = trimmed[:157] + "..."
        print(f"WARN: stacked footnote at combined line {lineno}: {trimmed}", file=sys.stderr)

    fn_count = len(re.findall(r'^\[\^[^\]]+\]:', combined, re.MULTILINE))

    tmp_md = Path("/tmp/law_review_combined.md")
    tmp_md.write_text(combined)

    if output is None:
        safe_title = re.sub(r'[^\w\s\-]', '', meta['title']).strip()
        output = project_dir / "drafts" / f"{safe_title}.docx"

    if not TEMPLATE.exists():
        print(f"ERROR: Template not found at {TEMPLATE}", file=sys.stderr)
        sys.exit(1)

    # Resolve bibliography and CSL: prefer metadata, fall back to project conventions.
    # A relative path in ACTIVE_WORKFLOW.md is relative to the PROJECT, not to
    # wherever the build happens to be invoked from. Resolving it against the cwd
    # means the same project builds with citations from one directory and without
    # them from another -- and the miss is reported as INFO, so the DOCX ships with
    # every citation left as a raw [@key].
    def _project_relative(value: str) -> Path:
        path = Path(value).expanduser()
        return path if path.is_absolute() else (project_dir / path)

    bib_path = (_project_relative(meta["bibliography"]) if meta["bibliography"]
                else project_dir / "references" / "sources.bib")
    csl_path = _project_relative(meta["csl"]) if meta["csl"] else DEFAULT_CSL

    cmd = [
        "pandoc", str(tmp_md),
        "-o", str(output),
        f"--reference-doc={TEMPLATE}",
        "--from=markdown+footnotes",
        "--to=docx",
        "--wrap=none",
        "--filter=pandoc-crossref",
        "-M", "tblPrefix=Table",
        "-M", "figPrefix=Figure",
        "-M", "tableTitle=Table",
        "-M", "figureTitle=Figure",
    ]

    if bib_path.exists():
        # Law review style keeps every citation in a footnote; suppress the
        # auto-generated end-of-document bibliography list.
        cmd += [
            "--citeproc",
            f"--bibliography={bib_path}",
            "-M", "suppress-bibliography=true",
        ]
        if csl_path.exists():
            cmd += [f"--csl={csl_path}"]
        else:
            print(f"WARN: CSL not found at {csl_path}; pandoc will use default style", file=sys.stderr)
        # Bluebook container-title uses form="short"; wire in the Zotero-style
        # abbreviations JSON if the project ships one.
        abbrev_path = project_dir / "references" / "journal-abbreviations.json"
        if abbrev_path.exists():
            cmd += [f"--citation-abbreviations={abbrev_path}"]
    elif meta["bibliography"]:
        # The project ASKED for this file. Missing it is a build failure, not a
        # note: every citation would ship as a raw [@key] in the DOCX, and an
        # INFO line scrolls past unread.
        print(f"ERROR: bibliography declared in ACTIVE_WORKFLOW.md but not found "
              f"at {bib_path}; every citation would render as a raw [@key]",
              file=sys.stderr)
        sys.exit(1)
    else:
        print(f"INFO: no bibliography at {bib_path}; skipping citeproc", file=sys.stderr)

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERROR: pandoc failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    attach_svg_blips(output, project_dir)

    replace_header_placeholders(output, meta["short_title"], meta["journal_cite"])

    inject_acknowledgement(output, meta["acknowledgements"], meta.get("author_acks") or None)

    normalize_abstract_heading(output)

    inject_toc(output)

    force_widow_control(output)

    if fix_footnotes:
        scripts_dir = Path(__file__).resolve().parent.parent.parent / "docx-repair" / "scripts"
        fix_script = scripts_dir / "fix_footnotes.py"
        crossrefs_script = scripts_dir / "create_crossrefs.py"
        if fix_script.exists():
            subprocess.run(
                ["uv", "run", "--with", "lxml", "python3",
                 str(fix_script), str(output)],
                capture_output=True,
            )
        if crossrefs_script.exists():
            subprocess.run(
                ["uv", "run", "--with", "lxml", "python3",
                 str(crossrefs_script), "--docx", str(output)],
                capture_output=True,
            )

    # Restyle native tables (booktabs look + content-fit widths + landscape for
    # over-wide tables). Runs LAST so nothing downstream disturbs the tables.
    style_tables(output)

    print(f"Output: {output}")
    print(f"Sections: {len(drafts)}")
    print(f"Footnotes: {fn_count}")
    print(f"Words: ~{len(combined.split())}")

    if pdf:
        pdf_path = convert_to_pdf(output)
        if pdf_path:
            print(f"PDF: {pdf_path}")

    return output


def main():
    parser = argparse.ArgumentParser(description="Build law review DOCX from markdown drafts")
    parser.add_argument("project_dir", type=Path, help="Project directory containing drafts/")
    parser.add_argument("--output", "-o", type=Path, help="Output DOCX path")
    parser.add_argument("--no-fix-footnotes", dest="fix_footnotes", action="store_false",
                        help="Skip docx-repair footnote repair + supra/infra crossrefs (default: on)")
    parser.add_argument("--pdf", action="store_true",
                        help="After building the DOCX, also render to PDF via LibreOffice headless")
    parser.set_defaults(fix_footnotes=True)
    args = parser.parse_args()

    if not args.project_dir.exists():
        print(f"ERROR: {args.project_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    build(args.project_dir, args.output, args.fix_footnotes, args.pdf)


if __name__ == "__main__":
    main()
