#!/usr/bin/env -S uv run python3
"""
workshop_slide_table.py — THE single deterministic parser for the workshop Slide Spec.

This is the workshop analog of `scripts/writing/writing_section_index.py` and
`scripts/dev/dev_plan_table.py`: ONE module that parses the OUTLINE.md slide spec into a
DATA work-list, shared by (a) the guard (`workshop-outline-executable-guard.py`,
`validate = build_index().violations`) and (b) the GENERATE engine (`workshop-generate.js`
consumes the work-list via args instead of an LLM Discover). It kills the doubled
LLM-Discover drift mask (DESIGN §3) and makes "parses ⇔ passes the guard" a property.

TWO INPUT FORMS (tolerant-at-parser, canonical-at-emitter — DESIGN §3, D-w-5):
  • CANONICAL TABLE (born-canonical, going forward): a markdown table with columns
    Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes — 7 fields/row.
  • LEGACY PROSE (real shipped decks, e.g. opv): `### Part N` / `= Section` / `== Subsection`
    headings + `- Slide: "Takeaway." — bullets → [A2, R1, ...]` bullet lines. This is a
    4-FIELD SUBSET (takeaway, bullets, inventory, + section/subsection via headings); it has
    NO explicit Visual/Notes columns and NO slide numbers (numbers assigned by document order).

WORK-LIST ROLE DIFFERS BY CONSUMER (DESIGN §3a, the cardinality correction):
  • GENERATE: this work-list IS the enumerator (one fragment-agent per slide row).
  • VERIFY: slide enumeration STAYS sourced from slides.typ; this work-list is only the
    OUTLINE-side {section, inventory} candidate set for a SEMANTIC join (DESIGN §3a-join).
    The parser owns ENUMERATION, never the drifting-identifier JOIN.

CLI:  uv run python3 workshop_slide_table.py <OUTLINE.md | project-root | .planning> [--json]
"""

import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# Canonical table columns (born-canonical emitter writes all 7).
REQUIRED_COLS = ("slide", "section", "takeaway", "bullets", "inventory", "visual", "notes")
# An F/T/R/A inventory id token (R1, T12, A3, F4). Range "R1-R8" yields the literal endpoints
# [R1, R8] (NOT expanded) — this is the deliberate over-attach FIX vs the LLM Discover (DESIGN §3a-join).
_INV_TOK_RE = re.compile(r"[FTRA]\d+")
# A prose slide line: `- Slide: "Takeaway." — bullets → [A2, R1]`  (em-dash or hyphen separators tolerated).
_PROSE_SLIDE_RE = re.compile(r'^\s*-\s*Slide:\s*(?P<rest>.+)$')
# Pull the bracketed inventory tail `→ [ ... ]` (arrow optional; last bracket on the line).
_INV_TAIL_RE = re.compile(r'(?:→|->)?\s*\[(?P<ids>[^\]]*)\]\s*$')


def section_slug(name: str) -> str:
    """Unicode-safe slug (NFC; em-dash/colon survive as separators). Mirrors
    writing_section_index.section_slug — used to key OUTLINE rows for the verify side-table join."""
    s = unicodedata.normalize("NFC", name).strip()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE).strip("-")
    return s


@dataclass
class Slide:
    num: int                    # document-order number (assigned for prose; parsed for table)
    part: str                   # `### Part N: ...` header text ("" if none)
    section: str                # the `=` heading (the coarse fan-out / cardinality key)
    subsection: str             # the `==` heading ("" if none)
    group: str                  # composite fan-out key: "<section> / <subsection>"
    takeaway: str               # the slide's takeaway sentence (quoted in prose; Takeaway col in table)
    bullets: str                # body content (";"- or prose-separated)
    inventory: list[str]        # F/T/R/A ids (literal tokens; ranges kept as endpoints)
    visual: str                 # table-only ("" in prose form)
    notes: str                  # table-only ("" in prose form)
    title_slug: str             # section_slug(takeaway) — the join key candidate for verify

    def to_dict(self) -> dict:
        return {
            "num": self.num, "part": self.part, "section": self.section,
            "subsection": self.subsection, "group": self.group, "takeaway": self.takeaway,
            "bullets": self.bullets, "inventory": self.inventory, "visual": self.visual,
            "notes": self.notes, "titleSlug": self.title_slug,
        }


@dataclass
class SlideIndex:
    slides: list[Slide] = field(default_factory=list)
    form: str = "none"               # "table" | "prose" | "none"
    section_order: list[str] = field(default_factory=list)   # distinct `=` sections, in order
    group_order: list[str] = field(default_factory=list)     # distinct fan-out groups, in order
    outline_path: str = ""
    sources_path: str = ""
    paper_path: str = ""             # the source paper, from SOURCES.md "## Source Paper / - Path:"
    sources_inventory: list[str] = field(default_factory=list)  # ALL F/T/R/A ids in SOURCES.md (the canonical universe; verify's whitelist)
    violations: list[str] = field(default_factory=list)
    stale_approval: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.violations and bool(self.slides)

    def to_dict(self) -> dict:
        return {
            "form": self.form, "ok": self.ok,
            "outlinePath": self.outline_path, "sourcesPath": self.sources_path,
            "paperPath": self.paper_path, "sourcesInventory": self.sources_inventory,
            "sectionOrder": self.section_order, "groupOrder": self.group_order,
            "violations": self.violations, "staleApproval": self.stale_approval,
            "slides": [s.to_dict() for s in self.slides],
        }


# ── inventory tokens ──────────────────────────────────────────────────────────
def _inv_tokens(cell: str) -> list[str]:
    """Literal F/T/R/A tokens in order, de-duped. '[R1-R8]' → ['R1','R8'] (endpoints, not expanded)."""
    out, seen = [], set()
    for m in _INV_TOK_RE.finditer(cell or ""):
        tok = m.group(0)
        if tok not in seen:
            seen.add(tok); out.append(tok)
    return out


# ── table form (canonical) ─────────────────────────────────────────────────────
def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def find_slide_table(text: str):
    """(header_lower, rows) for the table whose header carries slide+section+takeaway+inventory;
    (None, None) if absent. Same detection as the legacy guard's find_slide_table."""
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not (line.startswith("|") and "|" in line[1:]):
            continue
        header = [c.strip().lower() for c in line.strip("|").split("|")]
        sep = lines[i + 1].strip() if i + 1 < len(lines) else ""
        is_sep = bool(re.match(r"^\|?[\s:|-]+\|[\s:|-]+\|?$", sep)) and "-" in sep
        if is_sep and {"slide", "section", "takeaway", "inventory"}.issubset(set(header)):
            rows, j = [], i + 2
            while j < len(lines) and lines[j].strip().startswith("|"):
                rows.append(_split_row(lines[j])); j += 1
            return header, rows
    return None, None


def _col_index(header, name) -> int:
    """Prefix-tolerant column lookup (dev's gotcha: 'Visual (figure/diagram)' satisfies 'visual')."""
    for i, h in enumerate(header):
        if h == name or h.startswith(name + " ") or h.startswith(name + "("):
            return i
    return -1


def _cell(header, cells, name) -> str:
    i = _col_index(header, name)
    try:
        return cells[i].strip().strip("`").strip() if i >= 0 else ""
    except IndexError:
        return ""


def _parse_table(text: str, idx: SlideIndex) -> None:
    header, rows = find_slide_table(text)
    if header is None:
        return
    idx.form = "table"
    missing = [c for c in REQUIRED_COLS if _col_index(header, c) < 0]
    if missing:
        idx.violations.append(f"Slide Spec table missing required column(s): {', '.join(missing)}.")
    seen = set()
    for cells in rows:
        slide = _cell(header, cells, "slide")
        m = re.match(r"^\s*\**\s*(\d+)\.", slide)
        if not m:
            idx.violations.append(f"Slide row '{slide[:40]}' has no leading 'N.' number.")
            continue
        n = int(m.group(1))
        if n in seen:
            idx.violations.append(f"Slide {n}: duplicate slide number.")
        seen.add(n)
        # The table's Section cell may carry both `=` Part and `==` subsection, with the
        # separator backtick-wrapped per the SKILL format ("Part 1: Motivation `==` The Rise").
        # Normalise backticks → spaces, then split on the `==` boundary.
        section = _cell(header, cells, "section").replace("`", " ")
        sec, _, sub = section.partition("==")
        sec = sec.replace("=", "").strip() or section.replace("=", "").strip()
        sub = sub.strip()
        takeaway = _cell(header, cells, "takeaway")
        visual = _cell(header, cells, "visual")
        notes = _cell(header, cells, "notes")
        inv_cell = _cell(header, cells, "inventory")
        for label, val in (("Takeaway", takeaway), ("Bullets", _cell(header, cells, "bullets")),
                           ("Inventory", inv_cell), ("Notes", notes)):
            if not val or val.upper() == "N/A":
                idx.violations.append(f"Slide {n}: {label} is empty/N/A — required for an executable slide spec.")
        if not visual or visual.upper() == "N/A":
            idx.violations.append(f"Slide {n}: Visual is empty/N/A — use 'none' if intentional.")
        inv = _inv_tokens(inv_cell)
        if inv_cell and not inv:
            idx.violations.append(f"Slide {n}: Inventory '{inv_cell[:30]}' has no F/T/R/A id.")
        group = f"{sec} / {sub}" if sub else sec
        idx.slides.append(Slide(
            num=n, part="", section=sec, subsection=sub, group=group, takeaway=takeaway,
            bullets=_cell(header, cells, "bullets"), inventory=inv, visual=visual, notes=notes,
            title_slug=section_slug(takeaway)))
    if not seen:
        idx.violations.append("Slide Spec table has no slide rows.")


# ── prose form (legacy, real shipped decks) ────────────────────────────────────
def _parse_prose(text: str, idx: SlideIndex) -> None:
    idx.form = "prose"
    part = section = subsection = ""
    n = 0
    for raw in text.splitlines():
        line = raw.rstrip()
        s = line.strip()
        if s.startswith("### "):
            part = s[4:].strip(); continue
        if s.startswith("== "):
            subsection = s[3:].strip(); continue
        if s.startswith("= "):
            section = s[2:].strip(); subsection = ""; continue
        pm = _PROSE_SLIDE_RE.match(line)
        if not pm:
            continue
        rest = pm.group("rest").strip()
        # inventory tail
        inv_cell = ""
        tail = _INV_TAIL_RE.search(rest)
        if tail:
            inv_cell = tail.group("ids")
            rest = rest[:tail.start()].rstrip()
        # takeaway = leading DOUBLE-quoted span; bullets = remainder after the em-dash/hyphen
        # separator. Closing delimiter is double-quote ONLY — a straight/curly apostrophe inside
        # the takeaway (e.g. "...didn't...", "...'do funds follow ISS?'...") must NOT close it.
        takeaway, bullets = rest, ""
        qm = re.match(r'^["“](?P<t>.+?)["”](?P<after>.*)$', rest)
        if qm:
            takeaway = qm.group("t").strip()
            after = qm.group("after").strip()
            after = re.sub(r'^\s*[—–-]\s*', "", after)   # strip the leading separator
            bullets = after.strip()
        n += 1
        group = f"{section} / {subsection}" if subsection else section
        inv = _inv_tokens(inv_cell)
        idx.slides.append(Slide(
            num=n, part=part, section=section, subsection=subsection, group=group,
            takeaway=takeaway, bullets=bullets, inventory=inv, visual="", notes="",
            title_slug=section_slug(takeaway)))
        # Prose-form violations (4-field subset — Visual/Notes NOT required here, back-compat):
        if not takeaway:
            idx.violations.append(f"Slide {n}: no takeaway sentence parsed from prose row.")
        if not inv:
            idx.violations.append(f"Slide {n} (\"{takeaway[:30]}\"): no F/T/R/A inventory id — every slide must cite ≥1.")


# ── stale-approval backstop (DESIGN §5) ────────────────────────────────────────
def _stale_approval(planning: Path, idx: SlideIndex) -> None:
    approved = planning / "OUTLINE_APPROVED.md"
    if not approved.is_file():
        return
    txt = approved.read_text(encoding="utf-8", errors="ignore")
    for key, live in (("slide_count", len(idx.slides)),
                      ("section_count", len(idx.section_order))):
        m = re.search(rf"^{key}:\s*(\d+)", txt, re.M)
        if m and int(m.group(1)) != live:
            idx.stale_approval.append(
                f"OUTLINE_APPROVED.md {key}={m.group(1)} but live OUTLINE.md has {live} — "
                f"the approval predates a structure change; re-approve before generating.")


# ── public API ──────────────────────────────────────────────────────────────────
def build_index(arg) -> SlideIndex:
    """Parse OUTLINE.md (table OR prose) into a SlideIndex work-list. `arg` may be the
    OUTLINE.md path, the project root, or its .planning dir. The guard consumes `.violations`."""
    p = Path(arg)
    if p.is_file() and p.name.endswith(".md"):
        outline = p
    else:
        planning = p / ".planning" if (p / ".planning").is_dir() else (p if p.name == ".planning" else p)
        outline = planning / "OUTLINE.md"
    idx = SlideIndex(outline_path=str(outline))
    if not outline.is_file():
        idx.violations.append(f"OUTLINE.md not found at {outline}")
        return idx
    planning = outline.parent
    sources = planning / "SOURCES.md"
    idx.sources_path = str(sources) if sources.is_file() else ""
    if idx.sources_path:
        src = sources.read_text(encoding="utf-8", errors="ignore")
        # first "- Path:" line (tolerate bold markers: "- **Path:**"); it is the primary paper.
        # expanduser() the leading ~ — the path is injected verbatim into agent Read() prompts, and a
        # subagent's Read("~/...") does NOT tilde-expand → file-not-found (opv-parity). Emit it expanded.
        pm = re.search(r"^\s*-\s*\*{0,2}Path:?\*{0,2}\s*(?P<p>.+?)\s*$", src, re.M)
        if pm:
            raw = pm.group("p").strip()
            idx.paper_path = str(Path(raw).expanduser()) if raw.startswith("~") else raw
    text = outline.read_text(encoding="utf-8", errors="ignore")

    if find_slide_table(text)[0] is not None:
        _parse_table(text, idx)
    else:
        _parse_prose(text, idx)
        if not idx.slides:
            idx.violations.append(
                "No executable Slide Spec found: neither a markdown table "
                "(Slide|Section|Takeaway|Bullets|Inventory|Visual|Notes) nor `- Slide: \"...\" → [IDs]` "
                "prose rows. workshop-generate cannot fan out.")

    # distinct section / group order (document order)
    for sl in idx.slides:
        if sl.section and sl.section not in idx.section_order:
            idx.section_order.append(sl.section)
        if sl.group and sl.group not in idx.group_order:
            idx.group_order.append(sl.group)

    # dangling inventory ref check + the canonical ID universe (verify's whitelist; only if SOURCES present)
    if idx.sources_path:
        src = sources.read_text(encoding="utf-8", errors="ignore")
        known = set(_INV_TOK_RE.findall(src))
        idx.sources_inventory = sorted(known, key=lambda t: (t[0], int(t[1:])))
        for sl in idx.slides:
            for tok in sl.inventory:
                if tok not in known:
                    idx.violations.append(f"Slide {sl.num}: inventory id {tok} not found in SOURCES.md.")

    _stale_approval(planning, idx)
    return idx


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--json"]
    as_json = "--json" in sys.argv
    target = args[0] if args else "."
    idx = build_index(target)
    if as_json:
        print(json.dumps(idx.to_dict(), indent=2, ensure_ascii=False))
        sys.exit(0 if idx.ok else 1)
    print(f"form={idx.form}  slides={len(idx.slides)}  sections={len(idx.section_order)}  "
          f"groups={len(idx.group_order)}  ok={idx.ok}")
    if idx.violations:
        print("VIOLATIONS:\n- " + "\n- ".join(idx.violations))
    if idx.stale_approval:
        print("STALE APPROVAL:\n- " + "\n- ".join(idx.stale_approval))
    sys.exit(0 if idx.ok else 1)


if __name__ == "__main__":
    main()
