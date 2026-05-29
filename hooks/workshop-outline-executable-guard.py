#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: block OUTLINE_APPROVED.md unless OUTLINE.md carries a machine-
EXECUTABLE per-slide Slide Spec table.

`workshop-generate` (the transform workflow) reads the Slide Spec table directly:
it fans out one fragment-agent per row (each builds its `#slide[...]` block + notes
from the pinned Takeaway/Bullets/Inventory/Visual), then an assembly agent stitches
the fragments under their Section headers into slides.typ + notes.typ. A title-only
outline (`- Slide: title — source → IDs`) forces every agent to invent content and
visuals — the failure mode the spec exists to prevent.

This guard fires when something writes `.planning/OUTLINE_APPROVED.md` (the Phase-2
approval artifact Phase 3 checks). It validates the sibling OUTLINE.md's Slide Spec
table and DENIES the approval if the table is missing or any row is incomplete.

Wired via workshop frontmatter:
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-outline-executable-guard.py

Standalone:  uv run python3 workshop-outline-executable-guard.py path/to/OUTLINE.md
"""

import json
import re
import sys
from pathlib import Path

REQUIRED = ("slide", "section", "takeaway", "bullets", "inventory", "visual", "notes")


def find_slide_table(text: str):
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and "|" in line[1:]:
            header = [c.strip().lower() for c in line.strip("|").split("|")]
            sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
            is_sep = bool(re.match(r"^\|?[\s:|-]+\|[\s:|-]+\|?$", sep)) and "-" in sep
            if is_sep and {"slide", "section", "takeaway", "inventory"}.issubset(set(header)):
                rows = []
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|"):
                    rows.append([c.strip() for c in lines[j].strip().strip("|").split("|")])
                    j += 1
                return header, rows
        i += 1
    return None, None


def col(header, cells, name):
    try:
        return cells[header.index(name)].strip().strip("`").strip()
    except (ValueError, IndexError):
        return ""


def validate(outline_path: Path):
    if not outline_path.is_file():
        return [f"OUTLINE.md not found at {outline_path}"]
    header, rows = find_slide_table(outline_path.read_text())
    if header is None:
        return ["No executable Slide Spec table found (need a markdown table with columns "
                "Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes). The outline "
                "appears to list slides as `- Slide: title — source → IDs` prose, which "
                "workshop-generate cannot fan out into per-slide fragment generation."]
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        return [f"Slide Spec table is missing required column(s): {', '.join(missing)}."]
    violations = []
    seen = set()
    for cells in rows:
        slide = col(header, cells, "slide")
        m = re.match(r"^(\d+)\.", slide)
        if not m:
            violations.append(f"Slide row '{slide[:40]}' has no leading 'N.' number.")
            continue
        n = int(m.group(1))
        if n in seen:
            violations.append(f"Slide {n}: duplicate slide number.")
        seen.add(n)
        for name, label in (("section", "Section"), ("takeaway", "Takeaway"),
                            ("bullets", "Bullets"), ("inventory", "Inventory"),
                            ("visual", "Visual"), ("notes", "Notes")):
            val = col(header, cells, name)
            if not val or val.upper() == "N/A":
                # Visual may legitimately be "none"; everything else must be substantive.
                if name == "visual" and val.lower() == "none":
                    continue
                violations.append(f"Slide {n}: {label} is empty/N/A — required for an executable slide spec.")
        inv = col(header, cells, "inventory")
        if inv and not re.search(r"[FTRA]\d", inv):
            violations.append(f"Slide {n}: Inventory '{inv}' has no F/T/R/A id — every slide must cite ≥1 SOURCES.md inventory item.")
    if not seen:
        violations.append("Slide Spec table has no slide rows.")
    return violations


def deny(reason: str):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}))
    sys.exit(0)


def main():
    if len(sys.argv) > 1 and sys.argv[1] not in ("-",):
        v = validate(Path(sys.argv[1]))
        if v:
            print("OUTLINE NOT EXECUTABLE:\n- " + "\n- ".join(v)); sys.exit(1)
        print("OUTLINE executable: Slide Spec table is complete."); sys.exit(0)
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if hook_input.get("tool_name", "") not in ("Write", "Edit"):
        sys.exit(0)
    fp = hook_input.get("tool_input", {}).get("file_path", "")
    if not fp or not fp.endswith("OUTLINE_APPROVED.md"):
        sys.exit(0)
    outline = Path(fp).parent / "OUTLINE.md"
    v = validate(outline)
    if v:
        deny("GATE BLOCKED: OUTLINE.md is not machine-executable, so it cannot be approved "
             "for slide generation.\n\n"
             f"`{outline}` problems:\n- " + "\n- ".join(v) + "\n\n"
             "workshop-generate fans out one fragment-agent per Slide Spec row. Fix the table "
             "(Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes), then re-approve. "
             "Do NOT list slides as `- Slide: title` prose.")
    sys.exit(0)


if __name__ == "__main__":
    main()
