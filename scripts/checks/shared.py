"""Shared utilities for slide check scripts.

Parses Typst query metadata JSON into structured Python objects.
Used by overflow, CP-ref, and DQ-numbering checks.
"""

import json
import sys


def extract_text(body):
    """Flatten Typst content structure to plain text."""
    if isinstance(body, str):
        return body
    if isinstance(body, dict):
        func = body.get("func", "")
        if func == "text":
            return body.get("text", "")
        if func == "sequence":
            return "".join(extract_text(c) for c in body.get("children", []))
        if func == "space":
            return " "
        if func in ("emph", "strong"):
            return extract_text(body.get("body", ""))
        if func == "symbol":
            return body.get("text", "")
        if func == "smartquote":
            return "'" if not body.get("double", True) else '"'
        if "text" in body:
            return body["text"]
        if "children" in body:
            return "".join(extract_text(c) for c in body["children"])
        if "body" in body:
            return extract_text(body["body"])
        return ""
    if isinstance(body, list):
        return "".join(extract_text(c) for c in body)
    return str(body)


def parse_metadata(data):
    """Parse typst query JSON into structured components.

    Handles both the raw format (headings + pages + counts only)
    and the legacy format (with pre-computed overflow-slide entries).

    Returns:
        dict with keys: headings, total_pages, counts
    """
    headings = []
    total_pages = None
    counts = {}

    for entry in data:
        check = entry.get("check")
        if check == "heading":
            headings.append({
                "level": entry["level"],
                "text": extract_text(entry.get("text", "")),
                "page": entry["page"],
            })
        elif check == "pages":
            total_pages = entry["total"]
        elif check == "counts":
            counts = entry

    return {
        "headings": headings,
        "total_pages": total_pages,
        "counts": counts,
    }


def parse_pres_metadata(data):
    """Parse presentation-mode typst query JSON.

    Extracts raw touying marker positions for Python-side overflow detection.

    Returns:
        dict with keys: headings, total_pages, slide_pages, subslide_pages
    """
    headings = []
    total_pages = None
    slide_pages = []
    subslide_pages = []

    for entry in data:
        check = entry.get("check")
        if check == "heading":
            headings.append({
                "level": entry["level"],
                "text": extract_text(entry.get("text", "")),
                "page": entry["page"],
            })
        elif check == "pages":
            total_pages = entry["total"]
        elif check == "touying-slide":
            slide_pages.append(entry["page"])
        elif check == "touying-subslide":
            subslide_pages.append(entry["page"])

    return {
        "headings": headings,
        "total_pages": total_pages,
        "slide_pages": slide_pages,
        "subslide_pages": subslide_pages,
    }


def group_sections(headings):
    """Group level-3 headings by their parent level-1/2 section.

    Returns:
        list of (section_heading, [slide_headings]) tuples
    """
    sections = []
    current_section = None
    current_slides = []

    for h in headings:
        if h["level"] <= 2:
            if current_section is not None:
                sections.append((current_section, current_slides))
            current_section = h
            current_slides = []
        elif h["level"] == 3:
            current_slides.append(h)

    if current_section is not None:
        sections.append((current_section, current_slides))

    return sections


def read_json_input():
    """Read JSON from stdin."""
    return json.loads(sys.stdin.read())
