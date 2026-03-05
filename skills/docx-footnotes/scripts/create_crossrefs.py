#!/usr/bin/env python3
"""Convert hardcoded supra/infra note cross-references to NOTEREF field codes.

Scans footnotes.xml for patterns like "supra note 42" and replaces the hardcoded
number with a NOTEREF field code that auto-updates when footnotes are renumbered.
Also adds bookmarks to target footnotes in document.xml.

Usage:
    python3 create_crossrefs.py --docx path/to/file.docx --dry-run
    python3 create_crossrefs.py --docx path/to/file.docx
    python3 create_crossrefs.py --docx path/to/file.docx --output corrected.docx
"""

import argparse
import copy
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

# Match range: "supra/infra notes 209-210" or "209–210"
RANGE_PAT = re.compile(r"(?:supra|infra)\s+notes?\s+(\d+)\s*[-\u2013]\s*(\d+)")
# Match single: "supra/infra note 42"
SINGLE_PAT = re.compile(r"(?:supra|infra)\s+notes?\s+(\d+)")


# ── Helpers ─────────────────────────────────────────────────────────────


def make_run(text, rpr_source=None):
    """Create a <w:r> with optional cloned rPr and a <w:t> child."""
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        r.append(copy.deepcopy(rpr_source))
    t = etree.SubElement(r, f"{{{W}}}t")
    t.text = text
    t.set(XML_SPACE, "preserve")
    return r


def make_noteref_field(bookmark_name, display_text, rpr_source=None):
    """Create 5 <w:r> elements for a NOTEREF field.

    Structure: begin | instrText | separate | display | end
    """
    runs = []

    # 1. Field begin
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        r.append(copy.deepcopy(rpr_source))
    fc = etree.SubElement(r, f"{{{W}}}fldChar")
    fc.set(f"{{{W}}}fldCharType", "begin")
    runs.append(r)

    # 2. Instruction text
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        r.append(copy.deepcopy(rpr_source))
    instr = etree.SubElement(r, f"{{{W}}}instrText")
    instr.set(XML_SPACE, "preserve")
    instr.text = f" NOTEREF {bookmark_name} \\h "
    runs.append(r)

    # 3. Field separator
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        r.append(copy.deepcopy(rpr_source))
    fc = etree.SubElement(r, f"{{{W}}}fldChar")
    fc.set(f"{{{W}}}fldCharType", "separate")
    runs.append(r)

    # 4. Display text (field result — updated by Word on Ctrl+A, F9)
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        r.append(copy.deepcopy(rpr_source))
    t = etree.SubElement(r, f"{{{W}}}t")
    t.text = display_text
    t.set(XML_SPACE, "preserve")
    runs.append(r)

    # 5. Field end
    r = etree.Element(f"{{{W}}}r")
    if rpr_source is not None:
        r.append(copy.deepcopy(rpr_source))
    fc = etree.SubElement(r, f"{{{W}}}fldChar")
    fc.set(f"{{{W}}}fldCharType", "end")
    runs.append(r)

    return runs


def has_noteref(fn_element):
    """Check if a footnote already contains a NOTEREF field."""
    for instr in fn_element.findall(f".//{{{W}}}instrText"):
        if instr.text and "NOTEREF" in instr.text:
            return True
    return False


def get_searchable_runs(paragraph):
    """Get (run_el, text, cumulative_pos) tuples, skipping field content.

    Field content = everything between fldChar begin and fldChar end,
    including instrText and display-value runs. This prevents the
    while-loop from re-matching numbers already converted to NOTEREFs.
    """
    entries = []
    cum = 0
    field_depth = 0

    for child in paragraph:
        if child.tag == f"{{{W}}}del":
            continue

        runs = []
        if child.tag == f"{{{W}}}r":
            runs = [child]
        elif child.tag == f"{{{W}}}ins":
            runs = list(child.findall(f"{{{W}}}r"))

        for run in runs:
            fld = run.find(f"{{{W}}}fldChar")
            if fld is not None:
                ftype = fld.get(f"{{{W}}}fldCharType")
                if ftype == "begin":
                    field_depth += 1
                elif ftype == "end":
                    field_depth = max(0, field_depth - 1)
                continue

            # Skip everything inside a field (instrText + result runs)
            if field_depth > 0:
                continue

            t_el = run.find(f"{{{W}}}t")
            text = (t_el.text or "") if t_el is not None else ""
            if text:
                entries.append((run, text, cum))
                cum += len(text)

    return entries


def find_run_at_pos(entries, pos):
    """Find (index, offset_within_run) for a character position."""
    for i, (_, text, cum) in enumerate(entries):
        if text and cum <= pos < cum + len(text):
            return i, pos - cum
    return None, None


# ── Step 1: Parse cross-references ─────────────────────────────────────


def get_display_to_id(doc_root):
    """Build {display_number: xml_id} from footnoteReferences in document order.

    Skips footnotes with customMarkFollows (e.g., author bio footnotes using
    symbols like *, †, ‡) since those are not part of the numbered sequence.
    """
    mapping = {}
    display = 0
    for ref in doc_root.iter(f"{{{W}}}footnoteReference"):
        fid = int(ref.get(f"{{{W}}}id"))
        if fid < 1:
            continue
        if ref.get(f"{{{W}}}customMarkFollows") == "1":
            continue
        display += 1
        mapping[display] = fid
    return mapping


def parse_crossrefs(fn_root):
    """Scan footnotes.xml for supra/infra note N patterns.

    Returns:
        refs: [(source_fn_id, target_display_num, type), ...]
        unique_targets: set of target display numbers needing bookmarks
    """
    refs = []
    unique_targets = set()

    for fn in fn_root.findall(f"{{{W}}}footnote"):
        fid = int(fn.get(f"{{{W}}}id", "0"))
        if fid < 1:
            continue
        if has_noteref(fn):
            continue

        for p in fn.findall(f".//{{{W}}}p"):
            entries = get_searchable_runs(p)
            text = "".join(t for _, t, _ in entries)

            range_starts = set()
            for m in RANGE_PAT.finditer(text):
                range_starts.add(m.start())
                n1, n2 = int(m.group(1)), int(m.group(2))
                refs.append((fid, n1, "range_start"))
                refs.append((fid, n2, "range_end"))
                unique_targets.update([n1, n2])

            for m in SINGLE_PAT.finditer(text):
                if m.start() not in range_starts:
                    n = int(m.group(1))
                    refs.append((fid, n, "single"))
                    unique_targets.add(n)

    return refs, unique_targets


# ── Step 2: Add bookmarks ──────────────────────────────────────────────


def get_existing_ref_bookmarks(doc_root):
    """Find _Ref bookmarks wrapping footnoteReferences.

    Returns {xml_fn_id: bookmark_name}.
    """
    existing = {}
    for bm_start in doc_root.findall(f".//{{{W}}}bookmarkStart"):
        name = bm_start.get(f"{{{W}}}name", "")
        if not name.startswith("_Ref"):
            continue
        parent = bm_start.getparent()
        bm_id = bm_start.get(f"{{{W}}}id")
        in_range = False
        for child in parent:
            if child is bm_start:
                in_range = True
                continue
            if (
                child.tag == f"{{{W}}}bookmarkEnd"
                and child.get(f"{{{W}}}id") == bm_id
            ):
                break
            if in_range and child.tag == f"{{{W}}}r":
                fn_ref = child.find(f"{{{W}}}footnoteReference")
                if fn_ref is not None:
                    fid = int(fn_ref.get(f"{{{W}}}id"))
                    existing[fid] = name
    return existing


def get_max_bookmark_id(*roots):
    """Find the maximum bookmark ID across all XML roots."""
    max_id = 0
    for root in roots:
        for tag in (f"{{{W}}}bookmarkStart", f"{{{W}}}bookmarkEnd"):
            for el in root.iter(tag):
                bid = int(el.get(f"{{{W}}}id", "0"))
                max_id = max(max_id, bid)
    return max_id


def add_bookmarks(doc_root, target_ids, existing, start_id):
    """Add bookmarks to target footnoteReferences in document.xml.

    Args:
        doc_root: parsed document.xml
        target_ids: {display_num: xml_fn_id} targets needing bookmarks
        existing: {xml_fn_id: bookmark_name} already bookmarked
        start_id: first available bookmark ID

    Returns {display_num: bookmark_name} for all targets.
    """
    bookmark_map = {}
    next_id = start_id

    for display_num in sorted(target_ids):
        xml_id = target_ids[display_num]

        if xml_id in existing:
            bookmark_map[display_num] = existing[xml_id]
            continue

        # Find the footnoteReference element
        ref_el = None
        for r in doc_root.iter(f"{{{W}}}footnoteReference"):
            if int(r.get(f"{{{W}}}id")) == xml_id:
                ref_el = r
                break

        if ref_el is None:
            print(f"  WARNING: footnoteReference id={xml_id} not found")
            continue

        run_el = ref_el.getparent()
        p_el = run_el.getparent()
        if run_el.tag != f"{{{W}}}r":
            print(f"  WARNING: footnoteReference id={xml_id} not inside w:r")
            continue

        bm_name = f"_Ref_fn{display_num}"
        run_pos = list(p_el).index(run_el)

        bm_start = etree.Element(f"{{{W}}}bookmarkStart")
        bm_start.set(f"{{{W}}}id", str(next_id))
        bm_start.set(f"{{{W}}}name", bm_name)

        bm_end = etree.Element(f"{{{W}}}bookmarkEnd")
        bm_end.set(f"{{{W}}}id", str(next_id))

        p_el.insert(run_pos, bm_start)  # before the run
        p_el.insert(run_pos + 2, bm_end)  # after the run (shifted by 1)

        bookmark_map[display_num] = bm_name
        next_id += 1

    return bookmark_map


# ── Step 3: Replace with NOTEREF ────────────────────────────────────────


def do_single_replace(paragraph, entries, match, target_num, bookmark_map):
    """Replace a single hardcoded number with NOTEREF field runs."""
    bm_name = bookmark_map[target_num]

    num_start = match.start(1)
    num_len = match.end(1) - num_start

    idx, offset = find_run_at_pos(entries, num_start)
    if idx is None:
        return False

    run_el, run_text, _ = entries[idx]
    if offset + num_len > len(run_text):
        print(f"  WARNING: number {target_num} spans runs, skipping")
        return False

    rpr = run_el.find(f"{{{W}}}rPr")
    prefix = run_text[:offset]
    suffix = run_text[offset + num_len :]

    new_runs = []
    if prefix:
        new_runs.append(make_run(prefix, rpr))
    new_runs.extend(make_noteref_field(bm_name, str(target_num), rpr))
    if suffix:
        new_runs.append(make_run(suffix, rpr))

    parent = run_el.getparent()
    pos = list(parent).index(run_el)
    parent.remove(run_el)
    for i, r in enumerate(new_runs):
        parent.insert(pos + i, r)

    return True


def do_range_replace(paragraph, entries, match, n1, n2, bookmark_map):
    """Replace a range like '209-210' with two NOTEREF fields."""
    bm1 = bookmark_map[n1]
    bm2 = bookmark_map[n2]

    idx1, off1 = find_run_at_pos(entries, match.start(1))
    idx2, off2 = find_run_at_pos(entries, match.start(2))

    if idx1 is None or idx2 is None:
        return False

    if idx1 != idx2:
        print(f"  WARNING: range {n1}-{n2} spans runs, skipping")
        return False

    run_el, run_text, _ = entries[idx1]
    rpr = run_el.find(f"{{{W}}}rPr")

    n1_len = len(str(n1))
    n2_len = len(str(n2))

    prefix = run_text[:off1]
    separator = run_text[off1 + n1_len : off2]  # the "-" or "–" between numbers
    suffix = run_text[off2 + n2_len :]

    new_runs = []
    if prefix:
        new_runs.append(make_run(prefix, rpr))
    new_runs.extend(make_noteref_field(bm1, str(n1), rpr))
    if separator:
        new_runs.append(make_run(separator, rpr))
    new_runs.extend(make_noteref_field(bm2, str(n2), rpr))
    if suffix:
        new_runs.append(make_run(suffix, rpr))

    parent = run_el.getparent()
    pos = list(parent).index(run_el)
    parent.remove(run_el)
    for i, r in enumerate(new_runs):
        parent.insert(pos + i, r)

    return True


def replace_with_noteref(fn_root, bookmark_map):
    """Replace all hardcoded note numbers with NOTEREF fields.

    Uses a while-loop per paragraph: after each replacement, re-scans with
    field-aware text extraction so already-converted numbers are invisible.
    """
    count = 0

    for fn in fn_root.findall(f"{{{W}}}footnote"):
        fid = int(fn.get(f"{{{W}}}id", "0"))
        if fid < 1:
            continue
        if has_noteref(fn):
            continue

        for p in fn.findall(f".//{{{W}}}p"):
            while True:
                entries = get_searchable_runs(p)
                text = "".join(t for _, t, _ in entries)

                # Try range first (more specific)
                m = RANGE_PAT.search(text)
                if m:
                    n1, n2 = int(m.group(1)), int(m.group(2))
                    if n1 in bookmark_map and n2 in bookmark_map:
                        if do_range_replace(p, entries, m, n1, n2, bookmark_map):
                            count += 2
                            continue

                # Try single
                m = SINGLE_PAT.search(text)
                if m:
                    n = int(m.group(1))
                    if n in bookmark_map:
                        if do_single_replace(p, entries, m, n, bookmark_map):
                            count += 1
                            continue

                break

    return count


# ── Main ────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Convert hardcoded supra/infra note references to NOTEREF fields"
    )
    parser.add_argument("--docx", required=True, help="Path to input DOCX file")
    parser.add_argument("--output", help="Output DOCX path (default: overwrite input)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without modifying the file",
    )
    args = parser.parse_args()

    docx_path = Path(args.docx).expanduser().resolve()
    if not docx_path.exists():
        print(f"ERROR: {docx_path} not found")
        sys.exit(1)

    output_path = Path(args.output).expanduser().resolve() if args.output else docx_path

    # ── Read DOCX ───────────────────────────────────────────────────
    with zipfile.ZipFile(docx_path, "r") as z:
        doc_xml = z.read("word/document.xml")
        fn_xml = z.read("word/footnotes.xml")
        all_items = z.infolist()
        all_data = {item.filename: z.read(item.filename) for item in all_items}
    doc_root = etree.fromstring(doc_xml)
    fn_root = etree.fromstring(fn_xml)

    # ── Step 1: Parse cross-references ──────────────────────────────
    print("Step 1: Parsing cross-references...")
    refs, unique_targets = parse_crossrefs(fn_root)

    display_to_id = get_display_to_id(doc_root)

    # Validate and convert display numbers to XML IDs
    valid_targets = {}
    for dn in sorted(unique_targets):
        if dn in display_to_id:
            valid_targets[dn] = display_to_id[dn]
        else:
            print(f"  WARNING: target display number {dn} has no footnote")

    # Group by source footnote for reporting
    by_source = {}
    for fn_id, target, rtype in refs:
        by_source.setdefault(fn_id, []).append((target, rtype))

    print(f"  Found {len(refs)} cross-references in {len(by_source)} footnotes")
    print(f"  Targeting {len(unique_targets)} unique footnotes ({len(valid_targets)} valid)")

    # ── Dry run ─────────────────────────────────────────────────────
    if args.dry_run:
        existing = get_existing_ref_bookmarks(doc_root)
        max_id = get_max_bookmark_id(doc_root, fn_root)

        print(f"\n{'─'*60}")
        print("Cross-references by source footnote:\n")
        for fn_id in sorted(by_source):
            targets = by_source[fn_id]
            parts = []
            for n, t in targets:
                suffix = f" [{t}]" if t != "single" else ""
                parts.append(f"{n}{suffix}")
            print(f"  FN{fn_id} -> {', '.join(parts)}")

        new_bm = sum(1 for dn in valid_targets if valid_targets[dn] not in existing)
        print(f"\nBookmarks: {len(valid_targets)} targets, {new_bm} new "
              f"(IDs starting at {max_id + 1})")
        for dn in sorted(valid_targets):
            xml_id = valid_targets[dn]
            if xml_id in existing:
                print(f"  FN{dn}: EXISTING ({existing[xml_id]})")
            else:
                print(f"  FN{dn}: NEW (_Ref_fn{dn})")

        print(f"\nDry run complete. No files modified.")
        return

    # ── Step 2: Add bookmarks ───────────────────────────────────────
    print("\nStep 2: Adding bookmarks to document.xml...")
    existing = get_existing_ref_bookmarks(doc_root)
    max_id = get_max_bookmark_id(doc_root, fn_root)
    bookmark_map = add_bookmarks(doc_root, valid_targets, existing, max_id + 1)

    new_count = sum(1 for dn in bookmark_map if valid_targets.get(dn) not in existing)
    print(f"  Added {new_count} new bookmarks "
          f"({len(bookmark_map) - new_count} already existed)")

    # ── Step 3: Replace with NOTEREF ────────────────────────────────
    print("\nStep 3: Replacing hardcoded numbers with NOTEREF fields...")
    replaced = replace_with_noteref(fn_root, bookmark_map)
    print(f"  Replaced {replaced} numbers with NOTEREF fields")

    # ── Write output ────────────────────────────────────────────────
    print("\nWriting output...")

    if output_path == docx_path:
        bak = docx_path.with_suffix(".bak")
        shutil.copy2(docx_path, bak)
        print(f"  Backup: {bak}")

    doc_out = etree.tostring(
        doc_root, xml_declaration=True, encoding="UTF-8", standalone=True
    )
    fn_out = etree.tostring(
        fn_root, xml_declaration=True, encoding="UTF-8", standalone=True
    )

    temp_path = output_path.with_suffix(".tmp.docx")
    with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as z_out:
        for item in all_items:
            if item.filename == "word/document.xml":
                z_out.writestr(item, doc_out)
            elif item.filename == "word/footnotes.xml":
                z_out.writestr(item, fn_out)
            else:
                z_out.writestr(item, all_data[item.filename])
    os.replace(temp_path, output_path)
    print(f"  Written to: {output_path}")
    print(f"\nDone. Open in Word -> Ctrl+A, F9 to update all fields.")


if __name__ == "__main__":
    main()
