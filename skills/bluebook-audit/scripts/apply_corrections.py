#!/usr/bin/env -S uv run python3
"""Apply Bluebook formatting corrections to DOCX footnotes.

Corrections applied:
- Small caps on journal/periodical names (run-splitting for embedded names)
- (Extensible: signal italic fixes, cross-ref fills, etc.)

Usage:
    uv run python3 scripts/apply_corrections.py --docx path/to/file.docx
    uv run python3 scripts/apply_corrections.py --docx path/to/file.docx --output corrected.docx
"""

import argparse
import copy
import os
import re
import zipfile
from collections import Counter
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

# ── Journal/periodical names to small-cap (longest match first) ──
# Order matters: check longer patterns before shorter prefixes
# Shared with scan_formatting.py — keep in sync
JOURNAL_NAMES = [
    # Long names first
    "Harvard Law School Forum on Corporate Governance",
    "Harv. L. Sch. F. on Corp. Governance",
    # Finance/econ/management journals
    "Ann. Rev. Fin. Econ.",
    "J. Applied Corp. Fin.",
    "ECGI Fin. Working Paper",
    "J. Acct. & Econ.",
    "J. Fin. Econ.",
    "J. L. & Econ.",
    "Rev. Fin. Stud.",
    "J. Acct. Res.",
    "J. Legal Analysis",
    "Mgmt. Sci.",
    # Law reviews/journals (multi-word)
    "Harv. Bus. L. Rev.",
    "S. Cal. L. Rev.",
    "Seattle U. L. Rev.",
    "Nw. U. L. Rev.",
    "N.Y.U. L. Rev.",
    "Cardozo L. Rev.",
    "Cornell L. Rev.",
    "Colum. L. Rev.",
    "Stan. L. Rev.",
    "Mich. L. Rev.",
    "B.U. L. Rev.",
    "Tex. L. Rev.",
    "Harv. L. Rev.",
    "Va. L. Rev.",
    "U. Pa. L. Rev.",
    "Emory L.J.",
    "Geo. L.J.",
    "Yale L.J.",
    "Duke L.J.",
    # Newspapers/periodicals
    "Institutional Inv.",
    "Wall St. J.",
    "Wash. Post",
    "N.Y. Times",
    "Fed. Reg.",
    "Fortune",
    "Semafor",
    "Bloomberg",
    "CNBC",
    # Single-word journals that appear after volume numbers
    "J. Fin.",
]

# Ambiguous names that need context validation
AMBIGUOUS_NAMES = {
    "Fortune": r'[\s\xa0]*[\(,]',       # must be followed by ( or ,
    "Bloomberg": r'[\s\xa0]*[\(,]',
    "CNBC": r'[\s\xa0]*[\(,]',
}


def make_run(text, rpr_source=None, add_smallcaps=False):
    """Create a new run, optionally cloning rPr and adding small caps."""
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        new_rpr = copy.deepcopy(rpr_source)
    else:
        new_rpr = etree.Element(f"{{{W}}}rPr")

    if add_smallcaps:
        if new_rpr.find(f"{{{W}}}smallCaps") is None:
            etree.SubElement(new_rpr, f"{{{W}}}smallCaps")

    if len(new_rpr) > 0:
        r.insert(0, new_rpr)

    t = etree.SubElement(r, f"{{{W}}}t")
    t.text = text
    t.set(XML_SPACE, "preserve")
    return r


def find_name_in_run(run_text, name):
    """Find name in run text, handling NBSP variants.

    Returns (start_idx, end_idx) in the ORIGINAL text, or None.
    """
    idx = run_text.find(name)
    if idx >= 0:
        return (idx, idx + len(name))

    escaped = re.escape(name)
    pattern = escaped.replace(r"\ ", r"[\s\xa0]")
    m = re.search(pattern, run_text)
    if m:
        return (m.start(), m.end())

    return None


def run_has_smallcaps(run_element):
    """Check if a run element already has small caps formatting."""
    rpr = run_element.find(f"{{{W}}}rPr")
    return rpr is not None and rpr.find(f"{{{W}}}smallCaps") is not None


def apply_smallcaps_to_name(fn_element, name, fn_id):
    """Find and apply small caps to a name in a footnote.

    Handles run-splitting when the name is part of a larger run.
    Returns True if a fix was applied.
    """
    for p in fn_element.findall(f".//{{{W}}}p"):
        children = list(p)
        for i, child in enumerate(children):
            if child.tag != f"{{{W}}}r":
                continue

            t_el = child.find(f"{{{W}}}t")
            if t_el is None or not t_el.text:
                continue

            if child.find(f"{{{W}}}footnoteRef") is not None:
                continue

            if run_has_smallcaps(child):
                continue

            text = t_el.text
            match = find_name_in_run(text, name)
            if match is None:
                continue

            start, end = match
            matched_text = text[start:end]

            # Validate ambiguous names by checking trailing context
            if name in AMBIGUOUS_NAMES:
                after = text[end:end+5] if end < len(text) else ""
                if not re.match(AMBIGUOUS_NAMES[name], after) and after.strip():
                    continue

            # Prevent "J. Fin." matching inside "J. Fin. Econ."
            if name == "J. Fin.":
                after = text[end:end+10] if end + 10 <= len(text) else text[end:]
                if after.startswith("Econ.") or after.startswith(" Econ."):
                    continue

            # Prevent "Institutional Inv." matching inside "Institutional Investors"
            if name == "Institutional Inv.":
                after_char = text[end:end+1] if end < len(text) else ""
                if after_char and after_char.isalpha():
                    continue

            # Split the run: prefix + name (small caps) + suffix
            rpr = child.find(f"{{{W}}}rPr")
            prefix = text[:start]
            suffix = text[end:]

            pos = list(p).index(child)
            p.remove(child)

            ins = pos
            if prefix:
                p.insert(ins, make_run(prefix, rpr))
                ins += 1

            p.insert(ins, make_run(matched_text, rpr, add_smallcaps=True))
            ins += 1

            if suffix:
                p.insert(ins, make_run(suffix, rpr))

            return True

    return False


def apply_journal_smallcaps(fn_root):
    """Apply small caps to all journal/periodical names. Returns list of (fid, name) applied."""
    details = []

    for fn in fn_root.findall(f".//{{{W}}}footnote"):
        fid = int(fn.get(f"{{{W}}}id", "0"))
        if fid < 1:
            continue

        for journal_name in JOURNAL_NAMES:
            max_passes = 5  # safety limit for multiple occurrences
            for _ in range(max_passes):
                if apply_smallcaps_to_name(fn, journal_name, fid):
                    details.append((fid, journal_name))
                    print(f"  FN {fid}: {journal_name} -> small caps")
                else:
                    break

    return details


def main():
    parser = argparse.ArgumentParser(description="Apply Bluebook formatting corrections to DOCX footnotes")
    parser.add_argument("--docx", required=True, help="Path to input DOCX file")
    parser.add_argument("--output", help="Output DOCX path (default: overwrite input)")
    args = parser.parse_args()

    input_path = Path(args.docx)
    if not input_path.exists():
        print(f"ERROR: {input_path} not found")
        return

    output_path = Path(args.output) if args.output else input_path

    print(f"Loading {input_path.name}...")
    z_in = zipfile.ZipFile(input_path, "r")
    fn_xml = z_in.read("word/footnotes.xml")
    fn_root = etree.fromstring(fn_xml)

    all_details = []

    # 1. Journal/periodical small caps
    print("\nApplying journal small caps...")
    sc_details = apply_journal_smallcaps(fn_root)
    all_details.extend(("smallcaps", fid, name) for fid, name in sc_details)

    # ── Summary ──
    total = len(all_details)
    print(f"\n{'='*60}")
    print(f"Applied {total} formatting corrections")

    if total == 0:
        print("No changes needed.")
        z_in.close()
        return

    by_type = Counter(t for t, _, _ in all_details)
    for t, c in by_type.most_common():
        print(f"  {t}: {c}")

    # ── Write output ──
    print(f"\nWriting {output_path.name}...")
    fn_out = etree.tostring(fn_root, xml_declaration=True, encoding="UTF-8", standalone=True)

    temp_path = output_path.with_suffix(".tmp.docx")
    with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as z_out:
        for item in z_in.infolist():
            if item.filename == "word/footnotes.xml":
                z_out.writestr(item, fn_out)
            else:
                z_out.writestr(item, z_in.read(item.filename))
    z_in.close()

    os.replace(temp_path, output_path)
    print("Done!")


if __name__ == "__main__":
    main()
