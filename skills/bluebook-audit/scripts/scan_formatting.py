#!/usr/bin/env python3
"""Scan DOCX footnotes for ALL Bluebook formatting issues.

Checks:
- Journal/periodical names missing small caps
- (Extensible: signal italic, book title small caps, etc.)

Usage:
    python3 scripts/scan_formatting.py --docx path/to/file.docx
    python3 scripts/scan_formatting.py --docx path/to/file.docx --output results.json
"""

import argparse
import json
import re
import zipfile
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# ── Journal/periodical names (longest match first) ──
# Shared with apply_corrections.py — keep in sync
KNOWN_JOURNALS = [
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

# Generic regex patterns to catch journals NOT in the known list above
JOURNAL_PATTERNS = [
    r'[A-Z][a-z]+\.?\s+L\.\s+Rev\.',           # "X L. Rev."
    r'[A-Z][a-z]+\.?\s+L\.J\.',                 # "X L.J."
    r'[A-Z][a-z]+\.?\s+[A-Z][a-z]+\.?\s+L\.\s+Rev\.',  # "X Y L. Rev."
]


def extract_all_footnotes(docx_path):
    """Extract ALL footnotes with per-run formatting info."""
    z = zipfile.ZipFile(docx_path, "r")
    root = etree.fromstring(z.read("word/footnotes.xml"))
    z.close()

    footnotes = {}
    for fn in root.findall(f".//{{{W}}}footnote"):
        fid = int(fn.get(f"{{{W}}}id", "0"))
        if fid < 1:
            continue

        runs = []
        for p in fn.findall(f".//{{{W}}}p"):
            for child in p:
                if child.tag == f"{{{W}}}r":
                    t = child.find(f"{{{W}}}t")
                    if t is None or not t.text:
                        continue
                    if child.find(f"{{{W}}}footnoteRef") is not None:
                        continue
                    rpr = child.find(f"{{{W}}}rPr")
                    is_italic = rpr is not None and rpr.find(f"{{{W}}}i") is not None
                    has_sc = rpr is not None and rpr.find(f"{{{W}}}smallCaps") is not None
                    runs.append({
                        "text": t.text,
                        "italic": is_italic,
                        "smallcaps": has_sc,
                    })
                elif child.tag == f"{{{W}}}hyperlink":
                    for r in child.findall(f"{{{W}}}r"):
                        t = r.find(f"{{{W}}}t")
                        if t is not None and t.text:
                            runs.append({
                                "text": t.text,
                                "italic": False,
                                "smallcaps": False,
                                "hyperlink": True,
                            })

        if runs:
            footnotes[fid] = runs

    return footnotes


def _check_format_overlap(runs, start, end, attr, expected):
    """Check if all runs overlapping [start, end) have attr == expected."""
    pos = 0
    for r in runs:
        run_start = pos
        run_end = pos + len(r["text"])
        if run_end > start and run_start < end:
            if r.get(attr, False) != expected:
                return False
        pos = run_end
    return True


def find_missing_smallcaps(footnotes):
    """Find journal names in roman text (missing small caps)."""
    findings = []

    for fid, runs in sorted(footnotes.items()):
        full_text = "".join(r["text"] for r in runs)

        for journal in KNOWN_JOURNALS:
            search = journal.replace(" ", r"[\s\xa0]")
            for m in re.finditer(search, full_text):
                start, end = m.start(), m.end()
                if not _check_format_overlap(runs, start, end, "smallcaps", True):
                    findings.append({
                        "fn_id": fid,
                        "issue": "journal_not_smallcaps",
                        "element": journal,
                        "matched": m.group(),
                        "context": full_text[max(0, start-20):end+20],
                    })
                    break  # once per journal per footnote

        # Regex patterns for journals not in known list
        for pattern in JOURNAL_PATTERNS:
            nbsp_pattern = pattern.replace(r'\s+', r'[\s\xa0]+').replace(r'\s*', r'[\s\xa0]*')
            for m in re.finditer(nbsp_pattern, full_text):
                matched_text = m.group()
                start, end = m.start(), m.end()

                already_found = any(
                    x["fn_id"] == fid and matched_text.startswith(x["element"][:10])
                    for x in findings
                )
                if already_found:
                    continue

                if not _check_format_overlap(runs, start, end, "smallcaps", True):
                    findings.append({
                        "fn_id": fid,
                        "issue": "journal_not_smallcaps",
                        "element": matched_text.strip(),
                        "matched": matched_text,
                        "context": full_text[max(0, start-20):end+20],
                    })

    return findings


def main():
    parser = argparse.ArgumentParser(description="Scan DOCX footnotes for Bluebook formatting issues")
    parser.add_argument("--docx", required=True, help="Path to DOCX file")
    parser.add_argument("--output", help="Output JSON path (default: scratch/formatting_issues.json beside DOCX)")
    args = parser.parse_args()

    docx_path = Path(args.docx)
    if not docx_path.exists():
        print(f"ERROR: {docx_path} not found")
        return

    output_path = Path(args.output) if args.output else docx_path.parent / "scratch" / "formatting_issues.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Extracting all footnotes from {docx_path.name}...")
    footnotes = extract_all_footnotes(docx_path)
    print(f"Extracted {len(footnotes)} footnotes")

    all_findings = []

    # 1. Journal small caps
    print("\nScanning for missing small caps...")
    sc_findings = find_missing_smallcaps(footnotes)
    all_findings.extend(sc_findings)

    # Deduplicate
    seen = set()
    unique = []
    for f in all_findings:
        key = (f["fn_id"], f["issue"], f["element"])
        if key not in seen:
            seen.add(key)
            unique.append(f)

    print(f"\nFound {len(unique)} formatting issues:")
    by_issue = {}
    for f in unique:
        by_issue.setdefault(f["issue"], []).append(f)
    for issue, items in by_issue.items():
        print(f"  {issue}: {len(items)}")
        for item in items[:5]:
            print(f"    FN {item['fn_id']}: {item['element']}")
        if len(items) > 5:
            print(f"    ... and {len(items) - 5} more")

    with open(output_path, "w") as f:
        json.dump(unique, f, indent=2)
    print(f"\nSaved to {output_path}")


if __name__ == "__main__":
    main()
