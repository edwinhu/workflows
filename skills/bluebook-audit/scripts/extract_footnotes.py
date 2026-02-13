#!/usr/bin/env python3
"""Extract footnotes from DOCX, build citation registry, resolve cross-refs,
and run mechanical Bluebook checks.

Usage:
    python3 scripts/extract_footnotes.py --docx path/to/file.docx
    python3 scripts/extract_footnotes.py --docx path/to/file.docx --output results.json
    python3 scripts/extract_footnotes.py --docx path/to/file.docx --overrides overrides.json
"""

import argparse
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

from lxml import etree

# --- XML namespaces ---
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"

# --- Placeholder pattern (matches [_], [ ], [  ], [ _ ], etc.) ---
PLACEHOLDER_RE = re.compile(r"\[\s*_?\s*\]")

# --- Signals in Bluebook order (Rule 1.2) ---
SIGNAL_ORDER = [
    "[no signal]",
    "e.g.,",
    "accord",
    "see",
    "see also",
    "cf.",
    "compare",
    "contra",
    "but see",
    "but cf.",
    "see generally",
]


def extract_footnotes(docx_path):
    """Extract all footnotes with run-level formatting from DOCX."""
    z = zipfile.ZipFile(docx_path)

    # Parse footnotes.xml
    fn_xml = z.read("word/footnotes.xml")
    fn_root = etree.fromstring(fn_xml)

    # Parse footnotes.xml.rels for hyperlinks
    rels_xml = z.read("word/_rels/footnotes.xml.rels")
    rels_root = etree.fromstring(rels_xml)
    hyperlinks = {}
    for rel in rels_root.findall(f".//{{{PKG}}}Relationship"):
        if "hyperlink" in rel.get("Type", ""):
            hyperlinks[rel.get("Id")] = rel.get("Target")

    # Parse document.xml for footnote display order
    doc_xml = z.read("word/document.xml")
    doc_root = etree.fromstring(doc_xml)
    fn_refs = doc_root.findall(f".//{{{W}}}footnoteReference")
    display_order = [int(ref.get(f"{{{W}}}id")) for ref in fn_refs]

    footnotes = {}
    for fn_elem in fn_root.findall(f".//{{{W}}}footnote"):
        fid = int(fn_elem.get(f"{{{W}}}id"))
        ftype = fn_elem.get(f"{{{W}}}type", "normal")
        if ftype != "normal":
            continue

        # Extract runs with formatting
        runs = []
        urls = []
        for para in fn_elem.findall(f".//{{{W}}}p"):
            # Check for hyperlinks in paragraph
            for hl in para.findall(f".//{{{W}}}hyperlink"):
                rid = hl.get(f"{{{R}}}id")
                if rid and rid in hyperlinks:
                    urls.append(hyperlinks[rid])

            for run in para.findall(f".//{{{W}}}r"):
                rpr = run.find(f"{{{W}}}rPr")
                text_el = run.find(f"{{{W}}}t")

                if text_el is not None and text_el.text:
                    fmt = {
                        "text": text_el.text,
                        "italic": False,
                        "smallCaps": False,
                        "bold": False,
                        "style": None,
                    }
                    if rpr is not None:
                        if rpr.find(f"{{{W}}}i") is not None:
                            i_elem = rpr.find(f"{{{W}}}i")
                            val = i_elem.get(f"{{{W}}}val", "true")
                            fmt["italic"] = val != "0" and val != "false"
                        if rpr.find(f"{{{W}}}smallCaps") is not None:
                            fmt["smallCaps"] = True
                        if rpr.find(f"{{{W}}}b") is not None:
                            fmt["bold"] = True
                        style_el = rpr.find(f"{{{W}}}rStyle")
                        if style_el is not None:
                            fmt["style"] = style_el.get(f"{{{W}}}val")
                    runs.append(fmt)

        full_text = "".join(r["text"] for r in runs).strip()
        display_num = display_order.index(fid) + 1 if fid in display_order else fid

        footnotes[fid] = {
            "id": fid,
            "display_num": display_num,
            "text": full_text,
            "runs": runs,
            "urls": urls,
        }

    return footnotes, display_order


def build_citation_registry(footnotes, display_order, manual_first_cites=None):
    """Build registry of first citations and hereinafter definitions."""
    registry = {
        "hereinafter": {},  # short_name -> {fn_id, full_cite}
        "first_cites": {},  # author_key -> {fn_id, full_text}
    }

    # 1. Hereinafter definitions
    hereinafter_re = re.compile(r"\[hereinafter\s+([^\]]+)\]")
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        matches = hereinafter_re.findall(fn["text"])
        for name in matches:
            registry["hereinafter"][name.strip()] = {
                "fn_id": fid,
                "full_text": fn["text"][:200],
            }

    # 2. Build first-cite map for all authors that appear in supra references
    # First, collect all supra short-names
    supra_re = re.compile(
        r"([A-Z][A-Za-z\u2019']+(?:\s*(?:,|&)\s*[A-Z][A-Za-z\u2019']+)*"
        r"(?:\s+et\s+al\.)?)"
        r"(?:,\s*[A-Z][A-Za-z\s]+?)?"  # optional title fragment
        r",?\s*supra\s+note"
    )

    # Collect short-name references
    supra_refs = defaultdict(list)
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        # Clean supra pattern: "AuthorName, supra note [_]"
        for m in re.finditer(
            r"(?:(?:See(?:\s+also)?|E\.g\.,|But\s+see|Cf\.|Compare)\s+)?"
            r"([A-Z][\w\u2019']+(?:(?:\s*[,&]\s*|\s+)(?:[A-Z][\w\u2019']+|et\s+al\.))*)"
            r"(?:,\s+([A-Z][^,]+?))?"  # optional title fragment
            r",?\s+supra\s+note\s*" + PLACEHOLDER_RE.pattern,
            fn["text"],
        ):
            author_key = m.group(1).strip()
            title_frag = m.group(2).strip() if m.group(2) else None
            lookup_key = author_key
            if title_frag:
                lookup_key = f"{author_key}, {title_frag}"
            supra_refs[lookup_key].append(fid)

    # For hereinafter short-names with supra
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        for m in re.finditer(
            r"((?:GAO|CRS|SEC)\s+\w+|"
            r"(?:Senate|House)\s+[\w\s.]+?(?:Letter|Report|Release)|"
            r"Exec\.\s+Order\s+No\.\s+[\d,]+|"
            r"Tex\.\s+S\.B\.\s+\d+|"
            r"(?:ISS|SEC)\s+(?:v\.|2020)\s+\w+|"
            r"[\w\s]+?(?:Regulation|Release|Advisers))"
            r",?\s+supra\s+note\s*" + PLACEHOLDER_RE.pattern,
            fn["text"],
        ):
            name = m.group(1).strip()
            supra_refs[name].append(fid)

    # Manual override table for short-names -> first-cite footnote IDs
    # Load from external JSON if provided, otherwise empty
    MANUAL_FIRST_CITES = manual_first_cites or {}

    # Now find first citations for each short-name
    for short_name, ref_fns in supra_refs.items():
        # Check manual override first
        if short_name in MANUAL_FIRST_CITES:
            target_fid = MANUAL_FIRST_CITES[short_name]
            fn = footnotes.get(target_fid)
            if fn:
                registry["first_cites"][short_name] = {
                    "fn_id": target_fid,
                    "full_text": fn["text"][:300],
                    "source": "manual",
                }
                continue

        earliest_ref = min(ref_fns)
        # Search for full citation in footnotes before earliest reference
        # Author key is the part before any comma
        author_part = short_name.split(",")[0].strip()

        for fid in display_order:
            if fid >= earliest_ref:
                break
            fn = footnotes.get(fid)
            if not fn:
                continue
            # Check if this footnote contains the author name as part of a full cite
            # (not a supra reference)
            if author_part in fn["text"] and "supra" not in fn["text"].split(author_part, 1)[-1][:30]:
                registry["first_cites"][short_name] = {
                    "fn_id": fid,
                    "full_text": fn["text"][:300],
                    "source": "auto",
                }
                break

    return registry


def resolve_crossrefs(footnotes, display_order, registry, manual_overrides=None):
    """Resolve [_] placeholders to footnote numbers using the citation registry."""
    resolutions = []

    # Manual overrides for specific footnote placeholders that are hard to regex
    # Format: {"source_fn,placeholder_idx": target_fn}
    # Loaded from external JSON if provided
    MANUAL_OVERRIDES = {}
    if manual_overrides:
        for key_str, target in manual_overrides.items():
            parts = key_str.split(",")
            MANUAL_OVERRIDES[(int(parts[0]), int(parts[1]))] = int(target)

    # Broad pattern: capture everything before "supra note [_]"
    # We'll clean up the short-name after matching
    supra_placeholder_re = re.compile(
        r"([A-Z][\w\u2019'\-]+(?:(?:\s*[,&]\s*|\s+)[\w\u2019'\-]+)*"
        r"(?:,\s+[A-Za-z][\w\s\u2019'\-]*?)?)"
        r",?\s+supra\s+note\s*(\[\s*_?\s*\])"
    )

    # Also catch non-author short-names (title-based, like "SEC 2020 Regulation")
    title_supra_re = re.compile(
        r"((?:Exec\.\s+Order\s+No\.\s+[\d,]+|"
        r"Tex\.\s+S\.B\.\s+\d+|"
        r"ISS\s+v\.\s+SEC|"
        r"SEC\s+2020\s+Regulation|"
        r"Proxy\s+Voting\s+by\s+Investment\s+Advisers|"
        r"Exemptions\s+from\s+the\s+Proxy\s+Rules\s+for\s+Proxy\s+Voting\s+Advice|"
        r"Comments\s+on\s+Proposed\s+Amendments|"
        r"Capital\s+Markets\s+Subcommittee\s+(?:Press\s+)?Release|"
        r"Evidence\s+from\s+Say\s+on\s+Pay|"
        r"Regulation\s+of\s+Communications\s+Among\s+Shareholders))"
        r",?\s+supra\s+note\s*(\[\s*_?\s*\])"
    )

    def _resolve_name(short_name):
        """Look up short_name in registry, return (target_fn, confidence)."""
        # Check hereinafter first
        for ha_name, ha_info in registry["hereinafter"].items():
            if ha_name == short_name or ha_name in short_name or short_name in ha_name:
                return ha_info["fn_id"], "high"

        # Exact match in first_cites
        if short_name in registry["first_cites"]:
            return registry["first_cites"][short_name]["fn_id"], "high"

        # Try partial match (author only, no title fragment)
        author_part = short_name.split(",")[0].strip()
        matches = [
            (key, info)
            for key, info in registry["first_cites"].items()
            if key.split(",")[0].strip() == author_part
        ]
        if len(matches) == 1:
            return matches[0][1]["fn_id"], "high"
        elif len(matches) > 1:
            # Multiple works - try title fragment disambiguation
            title_frag = short_name.split(",", 1)[1].strip() if "," in short_name else ""
            for key, info in matches:
                key_title = key.split(",", 1)[1].strip() if "," in key else ""
                if title_frag and (
                    title_frag.lower() in key.lower()
                    or title_frag.lower() in info["full_text"].lower()
                ):
                    return info["fn_id"], "high"
            # Return the earliest one as medium confidence
            earliest = min(matches, key=lambda x: x[1]["fn_id"])
            return earliest[1]["fn_id"], "medium"

        # Try substring match
        for key, info in registry["first_cites"].items():
            if short_name in key or key in short_name:
                source = info.get("source", "auto")
                conf = "high" if source == "manual" else "medium"
                return info["fn_id"], conf

        return None, "low"

    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        text = fn["text"]

        # Track which positions we've already matched to avoid duplicates
        matched_positions = set()

        # Match title-based short-names first (more specific)
        for m in title_supra_re.finditer(text):
            short_name = m.group(1).strip()
            placeholder = m.group(2)
            target_fn, confidence = _resolve_name(short_name)
            resolutions.append({
                "source_fn": fid,
                "short_name": short_name,
                "placeholder": placeholder,
                "target_fn": target_fn,
                "confidence": confidence,
                "context": text[max(0, m.start() - 10):m.end() + 10],
            })
            matched_positions.add(m.start(2))

        # Match author-based short-names
        for m in supra_placeholder_re.finditer(text):
            if m.start(2) in matched_positions:
                continue
            short_name = m.group(1).strip().rstrip(",").strip()
            # Strip leading signals
            short_name = re.sub(
                r"^(?:See(?:\s+also)?|E\.g\.,?|But\s+see|Cf\.|Compare)\s+",
                "", short_name, flags=re.IGNORECASE
            ).strip()
            placeholder = m.group(2)
            target_fn, confidence = _resolve_name(short_name)
            resolutions.append({
                "source_fn": fid,
                "short_name": short_name,
                "placeholder": placeholder,
                "target_fn": target_fn,
                "confidence": confidence,
                "context": text[max(0, m.start() - 10):m.end() + 10],
            })
            matched_positions.add(m.start(2))

    # Handle infra note [_]
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        for m in re.finditer(r"infra\s+note\s*(\[\s*_?\s*\])", fn["text"]):
            resolutions.append({
                "source_fn": fid,
                "short_name": "[infra reference]",
                "placeholder": m.group(1),
                "target_fn": None,
                "confidence": "low",
                "context": fn["text"][max(0, m.start() - 30):m.end() + 30],
            })

    # Handle bare "Supra note [_]" or "supra note [_]" without preceding short-name
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        for m in re.finditer(r"(?<!\w\s)(?:S|s)upra\s+note\s*(\[\s*_?\s*\])", fn["text"]):
            # Check if this position was already matched
            already_matched = False
            for r in resolutions:
                if r["source_fn"] == fid and m.group(1) in r.get("context", ""):
                    already_matched = True
                    break
            if not already_matched:
                resolutions.append({
                    "source_fn": fid,
                    "short_name": "[bare supra]",
                    "placeholder": m.group(1),
                    "target_fn": None,
                    "confidence": "low",
                    "context": fn["text"][max(0, m.start() - 30):m.end() + 30],
                })

    # Apply manual overrides
    # Build a counter of placeholders per footnote to match by index
    fn_placeholder_count = {}
    for r in resolutions:
        fid = r["source_fn"]
        if fid not in fn_placeholder_count:
            fn_placeholder_count[fid] = 0
        idx = fn_placeholder_count[fid]
        key = (fid, idx)
        if key in MANUAL_OVERRIDES:
            r["target_fn"] = MANUAL_OVERRIDES[key]
            r["confidence"] = "high"
            r["source_override"] = "manual"
        fn_placeholder_count[fid] = idx + 1

    return resolutions


def check_id_chains(footnotes, display_order):
    """Validate Id. chain correctness."""
    findings = []
    for i, fid in enumerate(display_order):
        fn = footnotes.get(fid)
        if not fn:
            continue
        text = fn["text"].strip()

        # Check if footnote starts with Id.
        if re.match(r"^\s*Id\.", text):
            if i == 0:
                findings.append({
                    "fn_id": fid,
                    "issue": "id_chain",
                    "severity": "error",
                    "description": "Id. used in first footnote (no preceding source).",
                })
                continue

            # Check preceding footnote
            prev_fid = display_order[i - 1]
            prev_fn = footnotes.get(prev_fid)
            if prev_fn:
                prev_text = prev_fn["text"].strip()
                # Check if preceding footnote has multiple distinct sources
                # (signals like "see also", semicolons separating sources)
                semicolons = prev_text.count(";")
                if semicolons >= 1 and not prev_text.strip().startswith("Id."):
                    findings.append({
                        "fn_id": fid,
                        "issue": "id_ambiguous",
                        "severity": "warning",
                        "description": f"Id. follows FN {prev_fid} which has {semicolons + 1} sources (semicolons: {semicolons}). Ambiguous reference.",
                        "prev_fn": prev_fid,
                    })

    return findings


def check_signals(footnotes, display_order):
    """Check signal ordering and italic formatting."""
    findings = []

    signal_pattern = re.compile(
        r"\b(See generally|But cf\.|But see|See also|See|Cf\.|E\.g\.,|Accord|Compare|Contra)\b",
        re.IGNORECASE,
    )

    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        text = fn["text"]

        # Find signals in text
        signals_found = []
        for m in signal_pattern.finditer(text):
            sig_text = m.group(1)
            sig_lower = sig_text.lower().rstrip(",").strip()
            signals_found.append({
                "text": sig_text,
                "position": m.start(),
                "normalized": sig_lower,
            })

        # Check signal ordering (within same footnote, separated by semicolons)
        if len(signals_found) > 1:
            # Split by semicolons to find signal groups
            for i in range(len(signals_found) - 1):
                s1 = signals_found[i]["normalized"]
                s2 = signals_found[i + 1]["normalized"]
                # Map to order index
                order_map = {s.lower().rstrip(","): idx for idx, s in enumerate(SIGNAL_ORDER)}
                idx1 = order_map.get(s1)
                idx2 = order_map.get(s2)
                if idx1 is not None and idx2 is not None and idx1 > idx2:
                    findings.append({
                        "fn_id": fid,
                        "issue": "signal_order",
                        "severity": "warning",
                        "description": f'Signal "{signals_found[i]["text"]}" appears before "{signals_found[i+1]["text"]}" but should come after per Rule 1.2.',
                    })

        # Check signal italic formatting
        for run in fn["runs"]:
            for sig_match in signal_pattern.finditer(run["text"]):
                sig_text = sig_match.group(1)
                # Signals should be italicized (except [no signal])
                if not run["italic"] and sig_text.strip() not in ["[no signal]"]:
                    # Check if it's at the start of the footnote text (some signals begin the fn)
                    findings.append({
                        "fn_id": fid,
                        "issue": "signal_not_italic",
                        "severity": "warning",
                        "description": f'Signal "{sig_text}" is not italicized.',
                    })

    return findings


def check_terminal_periods(footnotes, display_order):
    """Check that every footnote ends with a period."""
    findings = []
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        text = fn["text"].strip()
        if text and not text.endswith(".") and not text.endswith(".)"):
            findings.append({
                "fn_id": fid,
                "issue": "no_terminal_period",
                "severity": "error",
                "description": f'Footnote does not end with a period. Ends with: "...{text[-20:]}"',
            })
    return findings


def check_journal_smallcaps(footnotes, display_order):
    """Flag journal names that should be in small caps."""
    findings = []

    # More targeted journal pattern
    journal_indicators = re.compile(
        r"\b(\d+)\s+"
        r"((?:[A-Z][a-z]*\.?\s+)*"
        r"(?:L\.\s*(?:Rev|J|F|Q|Bull|Rep|Rec)\.|"
        r"J\.\s*(?:Corp|Fin|Int(?:'|')l|Emp|L|Econ|Bus|Pol)\.|"
        r"Rev\.\s*(?:Fin|L|Econ)\.))"
        r"\s+(\d+)"
    )

    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        for m in journal_indicators.finditer(fn["text"]):
            journal_name = m.group(2).strip()
            # Check if this run is already in small caps
            is_smallcaps = False
            for run in fn["runs"]:
                if journal_name in run["text"] or any(
                    part.strip() in run["text"]
                    for part in journal_name.split()
                    if len(part.strip()) > 2
                ):
                    if run["smallCaps"]:
                        is_smallcaps = True
                        break
            if not is_smallcaps:
                findings.append({
                    "fn_id": fid,
                    "issue": "journal_not_smallcaps",
                    "severity": "warning",
                    "description": f'Journal name "{journal_name}" should be in small caps.',
                    "journal_name": journal_name,
                })
    return findings


def extract_urls(footnotes, display_order):
    """Extract all URLs from footnotes."""
    url_re = re.compile(r"https?://[^\s,)]+")
    url_inventory = []

    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        # URLs from hyperlink relationships
        for url in fn["urls"]:
            url_inventory.append({
                "fn_id": fid,
                "url": url,
                "source": "hyperlink_rel",
                "is_permacc": "perma.cc" in url,
                "has_tracking": any(p in url for p in ["utm_", "?si=", "&si="]),
            })
        # URLs from text
        for m in url_re.finditer(fn["text"]):
            url = m.group(0).rstrip(".")
            if url not in [u["url"] for u in url_inventory if u["fn_id"] == fid]:
                url_inventory.append({
                    "fn_id": fid,
                    "url": url,
                    "source": "text",
                    "is_permacc": "perma.cc" in url,
                    "has_tracking": any(p in url for p in ["utm_", "?si=", "&si="]),
                })

    return url_inventory


def check_duplicates(footnotes, display_order):
    """Flag potential duplicate citations that should use Id. or supra."""
    findings = []

    # Build a simple fingerprint for each footnote
    # Strip signals, leading whitespace, and normalize
    def fingerprint(text):
        # Remove leading signals
        text = re.sub(r"^\s*(?:See(?:\s+also)?|E\.g\.,|But\s+see|Cf\.|Compare|Contra|Accord|See\s+generally)\s+", "", text, flags=re.IGNORECASE)
        # Remove Id. prefix
        text = re.sub(r"^\s*Id\.\s*(?:at\s+\S+\.?\s*)?", "", text)
        # Normalize whitespace
        text = re.sub(r"\s+", " ", text).strip()
        return text

    seen_cites = {}  # fingerprint -> list of (fid, text)
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        text = fn["text"].strip()
        fp = fingerprint(text)

        # Skip very short fingerprints (Id., etc.)
        if len(fp) < 30:
            continue

        # Check for near-duplicates (exact first 80 chars match)
        fp_key = fp[:80]
        if fp_key in seen_cites:
            prev_fid, prev_text = seen_cites[fp_key]
            findings.append({
                "fn_id": fid,
                "issue": "potential_duplicate",
                "severity": "warning",
                "description": f"Potential duplicate of FN {prev_fid}. Consider using Id. or supra short form.",
                "prev_fn": prev_fid,
                "this_text": text[:100],
                "prev_text": prev_text[:100],
            })
        else:
            seen_cites[fp_key] = (fid, text)

    return findings


def check_hardcoded_supra(footnotes, display_order):
    """Flag supra note N references that are hardcoded (might be wrong after reordering)."""
    findings = []
    for fid in display_order:
        fn = footnotes.get(fid)
        if not fn:
            continue
        for m in re.finditer(r"supra\s+note\s+(\d+)", fn["text"]):
            note_num = int(m.group(1))
            findings.append({
                "fn_id": fid,
                "issue": "hardcoded_supra",
                "severity": "info",
                "description": f"Hardcoded supra note {note_num} (not a placeholder). Verify this is correct.",
                "target_note": note_num,
            })
    return findings


def main():
    parser = argparse.ArgumentParser(
        description="Extract footnotes, build citation registry, resolve cross-refs, run mechanical checks"
    )
    parser.add_argument("--docx", required=True, help="Path to DOCX file")
    parser.add_argument("--output", help="Output JSON path (default: scratch/footnotes_data.json beside DOCX)")
    parser.add_argument("--overrides", help="JSON file with manual_first_cites and manual_crossref_overrides")
    args = parser.parse_args()

    docx_path = Path(args.docx)
    if not docx_path.exists():
        print(f"ERROR: {docx_path} not found")
        return

    output_path = Path(args.output) if args.output else docx_path.parent / "scratch" / "footnotes_data.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Load optional manual overrides
    manual_first_cites = {}
    manual_crossref_overrides = {}
    if args.overrides:
        overrides_path = Path(args.overrides)
        if overrides_path.exists():
            with open(overrides_path) as f:
                overrides = json.load(f)
            manual_first_cites = overrides.get("manual_first_cites", {})
            manual_crossref_overrides = overrides.get("manual_crossref_overrides", {})
            print(f"Loaded {len(manual_first_cites)} first-cite overrides, {len(manual_crossref_overrides)} crossref overrides")

    print(f"Extracting footnotes from: {docx_path}")
    footnotes, display_order = extract_footnotes(docx_path)
    print(f"  Extracted {len(footnotes)} footnotes")
    print(f"  Display order: {len(display_order)} references")

    print("Building citation registry...")
    registry = build_citation_registry(footnotes, display_order, manual_first_cites=manual_first_cites)
    print(f"  Hereinafter definitions: {len(registry['hereinafter'])}")
    print(f"  First citations tracked: {len(registry['first_cites'])}")
    for name, info in registry["hereinafter"].items():
        print(f"    [{name}] -> FN {info['fn_id']}")

    print("Resolving cross-references...")
    resolutions = resolve_crossrefs(footnotes, display_order, registry, manual_overrides=manual_crossref_overrides)
    high = sum(1 for r in resolutions if r["confidence"] == "high")
    med = sum(1 for r in resolutions if r["confidence"] == "medium")
    low = sum(1 for r in resolutions if r["confidence"] == "low")
    print(f"  Total: {len(resolutions)} | High: {high} | Medium: {med} | Low: {low}")

    print("Running mechanical checks...")
    all_findings = []

    id_findings = check_id_chains(footnotes, display_order)
    all_findings.extend(id_findings)
    print(f"  Id. chain issues: {len(id_findings)}")

    signal_findings = check_signals(footnotes, display_order)
    all_findings.extend(signal_findings)
    print(f"  Signal issues: {len(signal_findings)}")

    period_findings = check_terminal_periods(footnotes, display_order)
    all_findings.extend(period_findings)
    print(f"  Terminal period issues: {len(period_findings)}")

    journal_findings = check_journal_smallcaps(footnotes, display_order)
    all_findings.extend(journal_findings)
    print(f"  Journal small-caps issues: {len(journal_findings)}")

    duplicate_findings = check_duplicates(footnotes, display_order)
    all_findings.extend(duplicate_findings)
    print(f"  Potential duplicate citations: {len(duplicate_findings)}")

    hardcoded_findings = check_hardcoded_supra(footnotes, display_order)
    all_findings.extend(hardcoded_findings)
    print(f"  Hardcoded supra notes: {len(hardcoded_findings)}")

    print("Extracting URLs...")
    url_inventory = extract_urls(footnotes, display_order)
    print(f"  Total URLs: {len(url_inventory)}")
    print(f"  Perma.cc URLs: {sum(1 for u in url_inventory if u['is_permacc'])}")
    print(f"  URLs with tracking params: {sum(1 for u in url_inventory if u['has_tracking'])}")

    # Build output
    output = {
        "metadata": {
            "source_file": str(docx_path),
            "total_footnotes": len(footnotes),
            "display_order": display_order,
        },
        "footnotes": {
            str(fid): {
                "id": fn["id"],
                "display_num": fn["display_num"],
                "text": fn["text"],
                "runs": fn["runs"],
                "urls": fn["urls"],
            }
            for fid, fn in footnotes.items()
        },
        "citation_registry": {
            "hereinafter": {
                k: {"fn_id": v["fn_id"], "full_text": v["full_text"]}
                for k, v in registry["hereinafter"].items()
            },
            "first_cites": {
                k: {"fn_id": v["fn_id"], "full_text": v["full_text"]}
                for k, v in registry["first_cites"].items()
            },
        },
        "cross_ref_resolutions": resolutions,
        "mechanical_findings": all_findings,
        "url_inventory": url_inventory,
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nOutput written to: {output_path}")
    print(f"Total mechanical findings: {len(all_findings)}")

    # Summary by issue type
    by_type = defaultdict(int)
    for finding in all_findings:
        by_type[finding["issue"]] += 1
    print("\nFindings by type:")
    for issue, count in sorted(by_type.items()):
        print(f"  {issue}: {count}")


if __name__ == "__main__":
    main()
