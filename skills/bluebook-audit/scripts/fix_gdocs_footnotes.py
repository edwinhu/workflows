#!/usr/bin/env -S uv run python3
"""Fix Google Docs footnote formatting damage in law review OOXML.

Google Docs round-trips destroy:
1. Separator/continuation footnotes (id=-1, 0)
2. Custom marks (customMarkFollows, w:sym) for author bio footnotes
3. Paragraph styles on ALL footnotes (FootnoteText / FNStyleBest)
4. Footnote ID numbering (shifts down because system footnotes are missing)
5. TOC separator paragraph height (causes spillover to second page)

This script detects whether these issues are present and fixes them.
It is idempotent — safe to run multiple times.

Usage:
    uv run python3 fix_gdocs_footnotes.py path/to/file.docx
    uv run python3 fix_gdocs_footnotes.py path/to/file.docx --output fixed.docx
    uv run python3 fix_gdocs_footnotes.py path/to/file.docx --dry-run
    uv run python3 fix_gdocs_footnotes.py path/to/file.docx --crossrefs  # also fix cross-refs
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# ── Custom mark definitions ────────────────────────────────────────────
AUTHOR_BIO_MARKS = [
    {"mark_type": "sym", "font": "Symbol", "char": "F02A",
     "detect_text": "*", "detect_re": r"\*"},
    {"mark_type": "text", "entity": "&#8224;",
     "detect_text": "\u2020", "detect_re": r"&#8224;|\u2020"},
    {"mark_type": "text", "entity": "&#8225;",
     "detect_text": "\u2021", "detect_re": r"&#8225;|\u2021"},
]

# The preferred footnote paragraph style
FN_PSTYLE = "FNStyleBest"


def read_zip_member(zf, name):
    return zf.read(name).decode("utf-8")


def detect_issues(fn_xml, doc_xml):
    """Detect which Google Docs damage is present."""
    issues = []

    if 'w:type="separator"' not in fn_xml:
        issues.append("missing_separators")

    if 'customMarkFollows="0"' in doc_xml and 'customMarkFollows="1"' not in doc_xml:
        issues.append("custom_marks_broken")

    if re.search(r'<w:footnote\s+w:id="0">', fn_xml) and 'w:type="separator"' not in fn_xml:
        issues.append("ids_shifted")

    # Count footnotes missing pStyle — this is the main formatting issue
    footnotes = re.findall(r'<w:footnote\s+w:id="(\d+)">(.*?)</w:footnote>', fn_xml, re.DOTALL)
    missing_style = sum(1 for fid, body in footnotes if 'w:pStyle' not in body)
    if missing_style > 0:
        issues.append(f"missing_pstyle({missing_style}/{len(footnotes)})")

    return issues


def fix_footnotes_xml(fn_xml, num_bio_footnotes=3):
    """Fix footnotes.xml formatting."""
    changes = []
    needs_id_shift = 'w:type="separator"' not in fn_xml

    if needs_id_shift:
        # 1. Shift all footnote IDs by +1
        for old_id in range(300, -1, -1):
            old = f'<w:footnote w:id="{old_id}">'
            new = f'<w:footnote w:id="{old_id + 1}">'
            if old in fn_xml:
                fn_xml = fn_xml.replace(old, new)
        changes.append("Shifted footnote IDs by +1")

        # 2. Add separator/continuation footnotes
        sep = """
  <w:footnote w:type="separator" w:id="-1">
    <w:p w14:paraId="279C7741" w14:textId="77777777" w:rsidR="003D4C1D" w:rsidRDefault="003D4C1D">
      <w:r>
        <w:separator/>
      </w:r>
    </w:p>
  </w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0">
    <w:p w14:paraId="331581F4" w14:textId="77777777" w:rsidR="003D4C1D" w:rsidRDefault="003D4C1D">
      <w:r>
        <w:continuationSeparator/>
      </w:r>
    </w:p>
  </w:footnote>"""
        fn_xml = re.sub(r'(<w:footnotes[^>]*>)', r'\1' + sep, fn_xml, count=1)
        changes.append("Added separator/continuation footnotes")

        # 3. Fix author bio custom marks
        for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
            fn_id = str(i + 1)
            if mark["mark_type"] == "sym":
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:sym w:font="{mark["font"]}" w:char="{mark["char"]}"/></w:r>')
            else:
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:t>{mark["entity"]}</w:t></w:r>')

            pattern = (
                rf'(<w:footnote w:id="{fn_id}">.*?)'
                r'<w:r[^>]*>\s*<w:rPr>\s*<w:rStyle w:val="FootnoteReference"/>\s*'
                r'(?:<w:vertAlign w:val="superscript"/>\s*)?</w:rPr>\s*'
                r'<w:footnoteRef/>\s*</w:r>\s*'
                r'<w:r[^>]*>\s*<w:rPr>.*?</w:rPr>\s*'
                rf'<w:t[^>]*>{mark["detect_re"]}</w:t>\s*</w:r>'
            )
            fn_xml_new = re.sub(pattern, rf'\1{repl}', fn_xml, count=1, flags=re.DOTALL)
            if fn_xml_new != fn_xml:
                fn_xml = fn_xml_new
                changes.append(f"Fixed bio footnote {fn_id} custom mark")

    # 4. Add pStyle to ALL footnotes missing it
    # Match footnotes with <w:pPr> that don't already have <w:pStyle>
    count = 0

    def add_pstyle(m):
        nonlocal count
        count += 1
        return m.group(1) + f'\n        <w:pStyle w:val="{FN_PSTYLE}"/>'

    fn_xml = re.sub(
        r'(<w:footnote\s+w:id="\d+">\s*<w:p[^>]*>\s*<w:pPr>)(?!\s*<w:pStyle)',
        add_pstyle,
        fn_xml
    )
    if count:
        changes.append(f"Added {FN_PSTYLE} pStyle to {count} footnotes")

    return fn_xml, changes


def fix_document_xml(doc_xml, num_bio_footnotes=3):
    """Fix document.xml footnote references."""
    changes = []
    needs_id_shift = 'customMarkFollows="1"' not in doc_xml

    if needs_id_shift:
        for old_id in range(300, -1, -1):
            old = f'w:customMarkFollows="0" w:id="{old_id}"'
            new = f'w:customMarkFollows="0" w:id="{old_id + 1}"'
            if old in doc_xml:
                doc_xml = doc_xml.replace(old, new)
        changes.append("Shifted footnoteReference IDs by +1")

        for i, mark in enumerate(AUTHOR_BIO_MARKS[:num_bio_footnotes]):
            fn_id = str(i + 1)
            if mark["mark_type"] == "sym":
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:footnoteReference w:customMarkFollows="1" w:id="{fn_id}"/>'
                        f'<w:sym w:font="{mark["font"]}" w:char="{mark["char"]}"/></w:r>')
            else:
                repl = (f'<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
                        f'<w:footnoteReference w:customMarkFollows="1" w:id="{fn_id}"/>'
                        f'<w:t>{mark["entity"]}</w:t></w:r>')

            pattern = (
                r'<w:r[^>]*>\s*<w:rPr>\s*<w:vertAlign w:val="superscript"/>\s*</w:rPr>\s*'
                rf'<w:footnoteReference w:customMarkFollows="0" w:id="{fn_id}"/>\s*</w:r>\s*'
                r'<w:r[^>]*>\s*<w:rPr>\s*<w:vertAlign w:val="superscript"/>\s*'
                r'(?:<w:rtl w:val="0"/>\s*)?</w:rPr>\s*'
                rf'<w:t[^>]*>{mark["detect_re"]}</w:t>\s*</w:r>'
            )
            doc_xml_new = re.sub(pattern, repl, doc_xml, count=1, flags=re.DOTALL)
            if doc_xml_new != doc_xml:
                doc_xml = doc_xml_new
                changes.append(f"Fixed bio reference {fn_id}")

    return doc_xml, changes


def fix_toc_separator(doc_xml):
    """Shrink the TOC-to-body separator paragraph to near-zero height."""
    changes = []
    pattern = (
        r'(</w:sdt>\s*<w:p[^>]*>.*?)'
        r'<w:spacing[^/]*/>'
        r'(.*?<w:br w:type="page"/>)'
    )

    def replacer(m):
        prefix, suffix = m.group(1), m.group(2)
        if re.search(r'<w:sz w:val="(?!2")[^"]*"', prefix + suffix):
            changes.append("Shrunk TOC separator paragraph")
            new = re.sub(r'<w:spacing[^/]*/>', '<w:spacing w:after="0" w:before="0" w:line="14" w:lineRule="auto"/>', prefix)
            new = re.sub(r'<w:sz w:val="[^"]*"/>', '<w:sz w:val="2"/>', new)
            new = re.sub(r'<w:szCs w:val="[^"]*"/>', '<w:szCs w:val="2"/>', new)
            return new + suffix
        return m.group(0)

    doc_xml = re.sub(pattern, replacer, doc_xml, count=1, flags=re.DOTALL)
    return doc_xml, changes


def main():
    parser = argparse.ArgumentParser(description="Fix Google Docs footnote formatting damage")
    parser.add_argument("docx", help="Path to the .docx file")
    parser.add_argument("--output", "-o", help="Output path (default: overwrite input)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change")
    parser.add_argument("--bio-footnotes", type=int, default=3,
                        help="Number of author bio footnotes (default: 3)")
    parser.add_argument("--crossrefs", action="store_true",
                        help="Also run create_crossrefs.py after fixing")
    args = parser.parse_args()

    docx_path = Path(args.docx).resolve()
    output_path = Path(args.output).resolve() if args.output else docx_path

    if not docx_path.exists():
        print(f"Error: {docx_path} not found", file=sys.stderr)
        sys.exit(1)

    with zipfile.ZipFile(docx_path, 'r') as zf:
        fn_xml = read_zip_member(zf, 'word/footnotes.xml')
        doc_xml = read_zip_member(zf, 'word/document.xml')

    issues = detect_issues(fn_xml, doc_xml)
    if not issues:
        print("No Google Docs formatting damage detected.")
        return

    print(f"Detected issues: {', '.join(issues)}")
    print()

    all_changes = []

    fn_xml_fixed, fn_changes = fix_footnotes_xml(fn_xml, args.bio_footnotes)
    all_changes.extend(fn_changes)

    doc_xml_fixed, doc_changes = fix_document_xml(doc_xml, args.bio_footnotes)
    all_changes.extend(doc_changes)

    doc_xml_fixed, toc_changes = fix_toc_separator(doc_xml_fixed)
    all_changes.extend(toc_changes)

    print(f"Changes ({len(all_changes)}):")
    for c in all_changes:
        print(f"  - {c}")

    if args.dry_run:
        print("\nDry run — no files modified.")
        return

    with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        with zipfile.ZipFile(docx_path, 'r') as zin:
            with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    if item.filename == 'word/footnotes.xml':
                        zout.writestr(item, fn_xml_fixed.encode('utf-8'))
                    elif item.filename == 'word/document.xml':
                        zout.writestr(item, doc_xml_fixed.encode('utf-8'))
                    else:
                        zout.writestr(item, zin.read(item.filename))

        shutil.move(tmp_path, output_path)
        print(f"\nWritten to: {output_path}")
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

    # Optionally run cross-refs
    if args.crossrefs:
        crossrefs_script = Path(__file__).parent / "create_crossrefs.py"
        if crossrefs_script.exists():
            print("\nRunning cross-reference conversion...")
            result = subprocess.run(
                [sys.executable, str(crossrefs_script), "--docx", str(output_path)],
                capture_output=True, text=True
            )
            print(result.stdout)
            if result.returncode != 0:
                print(result.stderr, file=sys.stderr)
        else:
            print(f"\nWarning: {crossrefs_script} not found, skipping cross-refs")

    print("Done. Open in Word -> Ctrl+A, F9 to update all fields.")


if __name__ == "__main__":
    main()
