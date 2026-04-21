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
    for i, section in enumerate(SECTION_ORDER):
        if stem.startswith(section):
            return i
    return 100


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


def resolve_includes(text: str) -> str:
    def repl(m: re.Match) -> str:
        raw = m.group(1).strip()
        path = Path(raw).expanduser()
        if not path.is_absolute():
            return f'<!-- MISSING (not absolute): {raw} -->'
        if not path.exists():
            return f'<!-- MISSING: {path} -->'
        return path.read_text()
    return INCLUDE_RE.sub(repl, text)


def get_prefix(path: Path) -> str:
    stem = path.stem.replace(" (Draft)", "")
    for section, prefix in PREFIXES.items():
        if stem.startswith(section):
            return prefix
    return stem.lower().replace(" ", "_")[:6]


LOREM = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit. "
         "Acknowledgements placeholder — replace via the acknowledgements: field "
         "in .planning/ACTIVE_WORKFLOW.md.")


def parse_metadata(project_dir: Path) -> dict:
    meta = {"title": "", "short_title": "", "author": "", "date": "", "acknowledgements": ""}
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


def inject_acknowledgement(docx_path: Path, ack_text: str) -> None:
    import zipfile, shutil
    from xml.sax.saxutils import escape
    with zipfile.ZipFile(docx_path, 'r') as z:
        contents = {n: z.read(n) for n in z.namelist()}

    doc = contents['word/document.xml'].decode('utf-8')
    fn = contents['word/footnotes.xml'].decode('utf-8')

    used_ids = set(int(x) for x in re.findall(r'w:id="(-?\d+)"', fn + doc))
    ack_id = 2
    while ack_id in used_ids:
        ack_id += 1

    star_ref = (
        f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
        f'<w:footnoteReference w:customMarkFollows="1" w:id="{ack_id}"/>'
        f'<w:sym w:font="Symbol" w:char="F02A"/></w:r>'
    )

    author_pat = re.compile(
        r'(<w:p>\s*<w:pPr>\s*<w:pStyle w:val="Author"\s*/>\s*</w:pPr>\s*<w:r>[^<]*<w:t[^>]*>[^<]*</w:t></w:r>)(\s*</w:p>)',
        re.DOTALL,
    )
    new_doc, n = author_pat.subn(lambda m: m.group(1) + star_ref + m.group(2), doc)
    if n == 0:
        print('WARN: Author paragraph not found; skipping acknowledgement injection', file=sys.stderr)
        return

    star_footnote = (
        f'<w:footnote w:id="{ack_id}">'
        f'<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
        f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
        f'<w:sym w:font="Symbol" w:char="F02A"/></w:r>'
        f'<w:r><w:t xml:space="preserve"> {escape(ack_text)}</w:t></w:r>'
        f'</w:p></w:footnote>'
    )
    new_fn = fn.replace('</w:footnotes>', star_footnote + '</w:footnotes>')

    contents['word/document.xml'] = new_doc.encode('utf-8')
    contents['word/footnotes.xml'] = new_fn.encode('utf-8')

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


def build(project_dir: Path, output: Optional[Path] = None, fix_footnotes: bool = False) -> Path:
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

    fn_count = len(re.findall(r'^\[\^[^\]]+\]:', combined, re.MULTILINE))

    tmp_md = Path("/tmp/law_review_combined.md")
    tmp_md.write_text(combined)

    if output is None:
        safe_title = re.sub(r'[^\w\s\-]', '', meta['title']).strip()
        output = project_dir / "drafts" / f"{safe_title}.docx"

    if not TEMPLATE.exists():
        print(f"ERROR: Template not found at {TEMPLATE}", file=sys.stderr)
        sys.exit(1)

    cmd = [
        "pandoc", str(tmp_md),
        "-o", str(output),
        f"--reference-doc={TEMPLATE}",
        "--from=markdown+footnotes",
        "--to=docx",
        "--wrap=none",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"ERROR: pandoc failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    replace_short_title(output, meta["short_title"])

    if fix_footnotes:
        fix_script = Path(__file__).resolve().parent.parent.parent / "docx-footnotes" / "scripts" / "fix_gdocs_footnotes.py"
        if fix_script.exists():
            subprocess.run(
                ["pixi", "exec", "--spec", "python=3.13", "--spec", "lxml", "--",
                 "python3", str(fix_script), str(output), "--crossrefs"],
                capture_output=True,
            )

    inject_acknowledgement(output, meta["acknowledgements"])

    print(f"Output: {output}")
    print(f"Sections: {len(drafts)}")
    print(f"Footnotes: {fn_count}")
    print(f"Words: ~{len(combined.split())}")
    return output


def main():
    parser = argparse.ArgumentParser(description="Build law review DOCX from markdown drafts")
    parser.add_argument("project_dir", type=Path, help="Project directory containing drafts/")
    parser.add_argument("--output", "-o", type=Path, help="Output DOCX path")
    parser.add_argument("--fix-footnotes", action="store_true", help="Run docx-footnotes repair")
    args = parser.parse_args()

    if not args.project_dir.exists():
        print(f"ERROR: {args.project_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    build(args.project_dir, args.output, args.fix_footnotes)


if __name__ == "__main__":
    main()
