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
import subprocess
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "bluebook-audit" / "scripts"))
from bluebook_signal_linter import lint as bluebook_lint, find_stacked_footnotes  # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent.parent / "writing-legal" / "templates" / "law_review_template.docx"

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


LOREM = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit. "
         "Acknowledgements placeholder — replace via the acknowledgements: field "
         "in .planning/ACTIVE_WORKFLOW.md.")


DEFAULT_CSL = Path.home() / "projects" / "bluebook-law-review-21e.csl"


def parse_metadata(project_dir: Path) -> dict:
    meta = {
        "title": "", "short_title": "", "author": "", "date": "",
        "acknowledgements": "", "author_acks": [],
        "csl": "", "bibliography": "",
    }
    aw = project_dir / ".planning" / "ACTIVE_WORKFLOW.md"
    if aw.exists():
        content = aw.read_text()
        for line in content.splitlines():
            if line.startswith("title:"):
                meta["title"] = line.split(":", 1)[1].strip().strip('"')
            elif line.startswith("short_title:"):
                meta["short_title"] = line.split(":", 1)[1].strip().strip('"')
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

    if not meta["acknowledgements"]:
        meta["acknowledgements"] = LOREM

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


def replace_short_title(docx_path: Path, short_title: str) -> None:
    import zipfile, shutil
    with zipfile.ZipFile(docx_path, 'r') as z:
        names = z.namelist()
        contents = {n: z.read(n) for n in names}
    replaced = False
    for name in list(contents):
        if name.startswith('word/header') and name.endswith('.xml'):
            text = contents[name].decode('utf-8')
            if '{{SHORT_TITLE}}' in text:
                contents[name] = text.replace('{{SHORT_TITLE}}', short_title).encode('utf-8')
                replaced = True
    if not replaced:
        return
    tmp = docx_path.with_suffix('.docx.tmp')
    with zipfile.ZipFile(docx_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, contents[item.filename])
    shutil.move(tmp, docx_path)


def convert_to_pdf_via_word(docx_path: Path) -> Optional[Path]:
    """Convert DOCX to PDF via Microsoft Word on macOS (osascript).

    Uses Word's actual layout engine — line breaks, font substitution, and
    pagination match what law-review editors and submission platforms see
    when they open the DOCX. Much more accurate than LibreOffice for widow
    detection and final-pass layout checks.
    """
    pdf_path = docx_path.with_suffix(".pdf")
    # Word needs activation to execute AppleScript, but we hide its windows
    # immediately via System Events so the interruption is minimal (~1-2s).
    # Leave Word running across builds to skip cold-start cost.
    script = f'''
    tell application "Microsoft Word"
        activate
        open POSIX file "{docx_path}"
        delay 1
        save as active document file format format PDF file name "{pdf_path}"
        close active document saving no
    end tell
    tell application "System Events"
        set visible of application process "Microsoft Word" to false
    end tell
    '''
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        print(f"WARN: Word PDF export failed:\n{result.stderr}", file=sys.stderr)
        return None
    if not pdf_path.exists():
        print(f"WARN: expected PDF at {pdf_path} but not found", file=sys.stderr)
        return None
    return pdf_path


def convert_to_pdf(docx_path: Path) -> Optional[Path]:
    """Convert DOCX to PDF. Prefers Word via osascript on macOS (accurate layout),
    falls back to LibreOffice headless (approximate layout, font-substituted)."""
    import shutil, sys as _sys
    # On macOS with Word installed, prefer osascript for layout accuracy.
    if _sys.platform == "darwin" and Path("/Applications/Microsoft Word.app").exists():
        pdf = convert_to_pdf_via_word(docx_path)
        if pdf:
            return pdf
        print("INFO: Word PDF export failed; falling back to LibreOffice", file=sys.stderr)
    # Fallback: LibreOffice headless.
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        print("WARN: no PDF renderer available (Word not installed and soffice not on PATH)", file=sys.stderr)
        return None
    outdir = docx_path.parent
    result = subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(docx_path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"WARN: LibreOffice PDF conversion failed:\n{result.stderr}", file=sys.stderr)
        return None
    pdf_path = outdir / (docx_path.stem + ".pdf")
    if not pdf_path.exists():
        print(f"WARN: expected PDF at {pdf_path} but not found", file=sys.stderr)
        return None
    return pdf_path


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

    # Resolve bibliography and CSL: prefer metadata, fall back to project conventions
    bib_path = Path(meta["bibliography"]).expanduser() if meta["bibliography"] else (project_dir / "references" / "sources.bib")
    csl_path = Path(meta["csl"]).expanduser() if meta["csl"] else DEFAULT_CSL

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
    else:
        print(f"INFO: no bibliography at {bib_path}; skipping citeproc", file=sys.stderr)

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERROR: pandoc failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    replace_short_title(output, meta["short_title"])

    inject_acknowledgement(output, meta["acknowledgements"], meta.get("author_acks") or None)

    normalize_abstract_heading(output)

    inject_toc(output)

    force_widow_control(output)

    if fix_footnotes:
        scripts_dir = Path(__file__).resolve().parent.parent.parent / "docx-footnotes" / "scripts"
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
                        help="Skip docx-footnotes repair + supra/infra crossrefs (default: on)")
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
