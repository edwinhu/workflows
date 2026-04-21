#!/usr/bin/env -S uv run python3
"""Check for slide overflow in handout and presentation modes.

All detection logic lives here — validation.typ only emits raw data.

Handout overflow: for each level-3 heading, if the gap to the next heading
  of ANY level is > 1 page, the slide overflows.

Presentation overflow: for each touying-new-slide marker, if the number of
  physical pages exceeds the number of touying-new-subslide markers in that
  range, the slide overflows.

Reads JSON from stdin. Expects a JSON object with two keys:
  - "handout": typst query output from handout pass
  - "presentation": typst query output from presentation pass

Exit codes: 0 = no overflow, 1 = overflow detected
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from shared import parse_metadata, parse_pres_metadata, extract_text


def detect_handout_overflow(headings, total_pages):
    """Detect slides that overflow in handout mode.

    In handout mode each heading occupies exactly 1 page, so a gap > 1
    between consecutive headings means the slide's content spills onto
    extra pages. We use ALL headings (not just level 3) because section
    dividers (= and ==) legitimately consume pages.

    Args:
        headings: list of {"level": int, "text": str, "page": int}
        total_pages: total physical page count

    Returns:
        list of {"text": str, "page": int, "pages_used": int, "next_heading": str|None, "next_page": int|None}
    """
    if not headings or total_pages is None:
        return []

    overflow = []
    for i, h in enumerate(headings):
        if h["level"] != 3:
            continue
        this_page = h["page"]
        next_page = headings[i + 1]["page"] if i + 1 < len(headings) else total_pages + 1
        gap = next_page - this_page
        if gap > 1:
            # Find the next level-3 heading for diagnostic context
            next_h3 = None
            for j in range(i + 1, len(headings)):
                if headings[j]["level"] == 3:
                    next_h3 = headings[j]
                    break
            overflow.append({
                "text": h["text"],
                "page": this_page,
                "pages_used": gap,
                "next_heading": next_h3["text"] if next_h3 else None,
                "next_page": next_h3["page"] if next_h3 else None,
            })
    return overflow


def detect_pres_overflow(headings, total_pages, slide_pages, subslide_pages):
    """Detect slides that overflow in presentation mode.

    For each logical slide boundary (touying-new-slide marker):
      - Count touying-new-subslide markers in that page range = expected pages
      - Compute actual page gap to next slide boundary
      - If actual > expected, the slide overflows

    Args:
        headings: list of {"level": int, "text": str, "page": int}
        total_pages: total physical page count
        slide_pages: list of page numbers for touying-new-slide markers
        subslide_pages: list of page numbers for touying-new-subslide markers

    Returns:
        list of {"text": str, "page": int, "pages_used": int, "subslides": int}
    """
    if not slide_pages or total_pages is None:
        return []

    overflow = []
    for i, start in enumerate(slide_pages):
        end = slide_pages[i + 1] if i + 1 < len(slide_pages) else total_pages + 1
        pages_used = end - start

        n_subslides = sum(1 for p in subslide_pages if start <= p < end)

        if pages_used > n_subslides:
            # Find the first level-3 heading in this range to identify the slide
            hdgs_in_range = [h for h in headings if h["level"] == 3 and start <= h["page"] < end]
            slide_text = hdgs_in_range[0]["text"] if hdgs_in_range else "—"

            overflow.append({
                "text": slide_text,
                "page": start,
                "pages_used": pages_used,
                "subslides": n_subslides,
            })

    return overflow


def check_overflow(handout_data, pres_data=None):
    """Detect overflow slides from raw typst query metadata.

    Args:
        handout_data: typst query JSON list (handout pass)
        pres_data: typst query JSON list (presentation pass), or None

    Returns:
        dict with keys:
            counts: {level1, level2, level3}
            total_pages: int
            handout_overflow: list of overflow entries
            pres_overflow: list of overflow entries
            has_violations: bool
    """
    meta = parse_metadata(handout_data)
    handout_overflow = detect_handout_overflow(meta["headings"], meta["total_pages"])

    pres_overflow = []
    if pres_data:
        pres_meta = parse_pres_metadata(pres_data)
        pres_overflow = detect_pres_overflow(
            pres_meta["headings"],
            pres_meta["total_pages"],
            pres_meta["slide_pages"],
            pres_meta["subslide_pages"],
        )

    return {
        "counts": meta["counts"],
        "total_pages": meta["total_pages"] or 0,
        "handout_overflow": handout_overflow,
        "pres_overflow": pres_overflow,
        "has_violations": bool(handout_overflow) or bool(pres_overflow),
    }


def format_results(result):
    """Format overflow results for human-readable output."""
    lines = []
    counts = result["counts"]
    lines.append(f"=   (level 1): {counts.get('level1', 0)}")
    lines.append(f"==  (level 2): {counts.get('level2', 0)}")
    lines.append(f"=== (level 3): {counts.get('level3', 0)}")
    lines.append(f"Physical pages: {result['total_pages']}")
    lines.append("")

    if result["handout_overflow"]:
        n = len(result["handout_overflow"])
        lines.append(f"\u26a0\ufe0f  OVERFLOW DETECTED (handout): {n} slide(s) spill to next page")
        lines.append("")
        for s in result["handout_overflow"]:
            extra = s["pages_used"] - 1
            lines.append(f"  Page {s['page']:3d} (+{extra}): {s['text'][:70]}")
            if s.get("next_heading"):
                lines.append(f"           (next slide: \"{s['next_heading'][:50]}\" at page {s['next_page']})")
        lines.append("")
    else:
        lines.append("\u2713 No overflow detected (handout mode)")

    if result["pres_overflow"]:
        n = len(result["pres_overflow"])
        lines.append("")
        lines.append(f"\u26a0\ufe0f  OVERFLOW DETECTED (presentation): {n} slide(s) overflow in presentation mode")
        lines.append("")
        for s in result["pres_overflow"]:
            extra = s["pages_used"] - s["subslides"]
            lines.append(f"  Page {s['page']:3d} (+{extra} extra): {s['text'][:70]}")
            lines.append(f"           ({s['subslides']} sub-slide(s) but {s['pages_used']} page(s) used)")
        lines.append("")
    else:
        lines.append("\u2713 No overflow detected (presentation mode)")

    return "\n".join(lines)


if __name__ == "__main__":
    data = json.loads(sys.stdin.read())

    # Support both wrapped {"handout": [...], "presentation": [...]}
    # and flat list (handout only)
    if isinstance(data, list):
        handout = data
        pres = []
    else:
        handout = data.get("handout", [])
        pres = data.get("presentation", [])

    result = check_overflow(handout, pres)
    print(format_results(result))
    sys.exit(1 if result["has_violations"] else 0)
