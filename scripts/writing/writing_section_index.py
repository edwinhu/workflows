#!/usr/bin/env -S uv run python3
"""
Shared, tolerant parser for the writing workflow's section index.

This is the deterministic replacement for the per-invocation LLM `Discover` agent in
workflows/writing-draft.js and workflows/writing-review.js. The section set, document
order, file pairing, and per-section claim assignment are all regex-parseable from the
approved planning artifacts; the only reason an LLM was ever used is that it tolerated
format drift a strict parser would reject (e.g. real outlines are named "<Name>.md",
not the documented "<Name> (Outline).md" — see DESIGN §3a, the drift-mask thesis).

Single source of truth for "what the document's sections are." Imported by:
  - scripts/writing/writing_compile.py            (feeds the engines a section index)
  - hooks/writing-outline-executable-guard.py     (validates at OUTLINE_REVIEWED approval)
so the engines and the guard can never disagree about the section set.

Canonical inputs (all under <project>/.planning unless noted):
  - OUTLINE.md  `## Structure`  → document order (### Section headings)
  - OUTLINE.md  `## Claim → Section Map`  → the PRIMARY claim home per section (the spec)
  - ACTIVE_WORKFLOW.md  `style:`  → legal | econ | general
  - <project>/outlines/<Name>.md      (tolerant: also "<Name> (Outline).md")
  - <project>/drafts/<Name> (Draft).md  (frontmatter `implements: [CLAIM-XX, ...]`)

Guard semantics (DESIGN D-w-3): draft.implements ⊇ {claims the map assigns to that
section}. NOT equality, NOT draft ⊆ outline — Intro/Conclusion legitimately survey all
claims (supersets) and the lead Parts carry their primary claims plus setup claims.

CLI:  uv run python3 writing_section_index.py /abs/project/.planning   # pretty-print
      (pass the project root OR its .planning dir; both work)
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

# A claim token anywhere: CLAIM-01, CLAIM-6 …  (canonicalised to zero-padded CLAIM-NN)
_CLAIM_RE = re.compile(r"CLAIM-(\d+)", re.I)
# A pandoc cite key in prose: [@foo2019], @foo2019
_CITEKEY_RE = re.compile(r"@([A-Za-z][\w:-]+)")
# A Part heading's roman numeral: "Part II. ..." / "Part III ..." → II / III
_PART_ROMAN_RE = re.compile(r"^Part\s+([IVXLC]+)\b", re.I)
# Placeholder / structureless markers that bounce an outline back to writing-outline
_PLACEHOLDER_RE = re.compile(r"\b(TBA|TBD|develop this|to be (written|drafted)|\d+\s*pgs?)\b", re.I)


def _canon_claim(num: str) -> str:
    return f"CLAIM-{int(num):02d}"


def claims_in(text: str) -> set[str]:
    return {_canon_claim(m.group(1)) for m in _CLAIM_RE.finditer(text)}


def section_slug(name: str) -> str:
    """Unicode-safe slug. NFC-normalise (em-dash survives as a separator), collapse
    whitespace+punctuation to single dashes. Mirrors check_section_cites.section_slug."""
    s = unicodedata.normalize("NFC", name).strip()
    s = re.sub(r"\s*\(Outline\)\s*$", "", s)
    s = re.sub(r"\s*\(Draft\)\s*$", "", s)
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE).strip("-")
    return s


@dataclass
class Section:
    name: str
    order: int
    outline_file: str | None        # absolute path, or None if missing
    draft_file: str | None          # absolute path, or None if missing
    primary_claims: list[str]       # from OUTLINE.md ## Claim → Section Map (the spec)
    implements: list[str]           # from the draft frontmatter (derived)
    sources_pinned: bool            # informational: does the outline pin [@key]/CLAIM-XX?
    granular: bool                  # mechanical floor: not a placeholder/bare-headings outline
    granularity_note: str           # why not granular, if applicable
    prev_name: str                  # "" at the ends
    next_name: str
    claim_ok: bool                  # draft.implements ⊇ primary_claims (the D-w-3 gate)

    def to_dict(self) -> dict:
        return {
            "name": self.name, "order": self.order,
            "outlineFile": self.outline_file, "draftFile": self.draft_file,
            "primaryClaims": self.primary_claims, "implements": self.implements,
            "sourcesPinned": self.sources_pinned, "granular": self.granular,
            "granularityNote": self.granularity_note,
            "prevName": self.prev_name, "nextName": self.next_name,
            "claimOk": self.claim_ok,
        }


@dataclass
class IndexResult:
    sections: list[Section] = field(default_factory=list)
    style: str = "unspecified"
    precis_path: str = ""            # absolute .planning/PRECIS.md, or "" if absent
    outline_path: str = ""           # absolute .planning/OUTLINE.md
    bib_path: str = ""               # absolute references/sources.bib (or any *.bib), or "" if none
    violations: list[str] = field(default_factory=list)
    stale_approval: list[str] = field(default_factory=list)  # DESIGN §5: *_REVIEWED disagrees with live

    @property
    def ok(self) -> bool:
        return not self.violations and bool(self.sections)

    def to_dict(self) -> dict:
        return {
            "style": self.style, "ok": self.ok,
            "precisPath": self.precis_path, "outlinePath": self.outline_path,
            "bibPath": self.bib_path,
            "violations": self.violations, "staleApproval": self.stale_approval,
            "sections": [s.to_dict() for s in self.sections],
        }


def _planning_dir(arg: Path) -> Path:
    """Accept either the project root or its .planning dir."""
    if arg.name == ".planning":
        return arg
    if (arg / ".planning").is_dir():
        return arg / ".planning"
    return arg  # last resort: treat as the planning dir


def _project_root(planning: Path) -> Path:
    return planning.parent if planning.name == ".planning" else planning


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _structure_order(outline_md: str) -> list[str]:
    """The `## Structure` block's `### Section` headings, in document order."""
    lines = outline_md.splitlines()
    names, in_structure = [], False
    for raw in lines:
        line = raw.strip()
        if re.match(r"^##\s+Structure\b", line, re.I):
            in_structure = True
            continue
        if in_structure and re.match(r"^##\s+\S", line):  # next H2 ends the block
            break
        if in_structure:
            m = re.match(r"^###\s+(.+?)\s*$", line)
            if m:
                names.append(m.group(1).strip())
    return names


def _roman_to_part(names: list[str]) -> dict[str, str]:
    """Map a roman numeral (II) → the section name that starts with 'Part II'."""
    out = {}
    for n in names:
        m = _PART_ROMAN_RE.match(n)
        if m:
            out[m.group(1).upper()] = n
    return out


def _claim_section_map(outline_md: str, roman_to_part: dict[str, str]) -> dict[str, set[str]]:
    """Parse `## Claim → Section Map` → {section_name: {primary CLAIM-XX, ...}}.

    Each row: | CLAIM-0X (...) | <PRIMARY home, e.g. II.A> | <setup/echo> |. Only the
    PRIMARY-home column counts toward a section's required claims (the spec)."""
    lines = outline_md.splitlines()
    in_map = False
    primary: dict[str, set[str]] = {}
    for raw in lines:
        line = raw.strip()
        if re.match(r"^##\s+Claim\s*[→\->]+\s*Section\s+Map", line, re.I):
            in_map = True
            continue
        if in_map and re.match(r"^##\s+\S", line):
            break
        if in_map and line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) < 2:
                continue
            claim_cell, home_cell = cells[0], cells[1]
            if re.match(r"^[-:\s|]+$", claim_cell) or claim_cell.lower() == "claim":
                continue  # separator / header row
            cset = claims_in(claim_cell)
            if not cset:
                continue
            rm = re.match(r"^([IVXLC]+)\b", home_cell, re.I)
            if rm:
                part_name = roman_to_part.get(rm.group(1).upper())
                if part_name:
                    primary.setdefault(part_name, set()).update(cset)
    return primary


def _frontmatter(text: str) -> dict:
    """Minimal YAML-ish frontmatter read: `implements:` (list or inline), `section:`."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    block = text[3:end]
    out: dict = {}
    m = re.search(r"^implements:\s*\[(.*?)\]", block, re.M | re.S)
    if m:
        out["implements"] = sorted({_canon_claim(x) for x in _CLAIM_RE.findall(m.group(1))},
                                   key=lambda c: int(c.split("-")[1]))
    sm = re.search(r"^section:\s*(.+)$", block, re.M)
    if sm:
        out["section"] = sm.group(1).strip()
    return out


def _pair_files(name: str, outdir: Path, draftdir: Path) -> tuple[str | None, str | None]:
    """Tolerant pairing: outline '<Name>.md' OR '<Name> (Outline).md'; draft
    '<Name> (Draft).md' OR '<Name>.md'. Returns absolute paths or None."""
    out_cands = [outdir / f"{name}.md", outdir / f"{name} (Outline).md"]
    draft_cands = [draftdir / f"{name} (Draft).md", draftdir / f"{name}.md"]
    outline = next((str(c.resolve()) for c in out_cands if c.is_file()), None)
    draft = next((str(c.resolve()) for c in draft_cands if c.is_file()), None)
    return outline, draft


def _granularity(outline_text: str) -> tuple[bool, str]:
    """Mechanical floor: a placeholder or a bare-headings outline bounces. The
    substantive 'is each point real' judgment stays with the upstream outline reviewer."""
    if not outline_text.strip():
        return False, "outline file missing or empty"
    if _PLACEHOLDER_RE.search(outline_text):
        m = _PLACEHOLDER_RE.search(outline_text)
        return False, f"placeholder marker present: '{m.group(0)}'"
    # bullet-groups = lines starting with -, *, or a bold lead; require a handful.
    bullets = [ln for ln in outline_text.splitlines() if re.match(r"^\s*([-*]|\d+\.)\s+\S", ln)]
    if len(bullets) < 3:
        return False, f"bare-headings: only {len(bullets)} bullet-level points"
    return True, ""


def _style(planning: Path) -> str:
    aw = _read(planning / "ACTIVE_WORKFLOW.md")
    m = re.search(r"^style:\s*([A-Za-z]+)", aw, re.M)
    return m.group(1).lower() if m else "unspecified"


def _stale_approval(planning: Path, outline_md: str, sections: list[Section]) -> list[str]:
    """DESIGN §5: an APPROVED *_REVIEWED.md that asserts a claim/Part count disagreeing
    with the live OUTLINE.md is a stale approval — surface, don't trust."""
    issues = []
    live_claims = claims_in(outline_md)
    live_parts = sum(1 for s in sections if _PART_ROMAN_RE.match(s.name))
    for fname in ("PRECIS_REVIEWED.md", "OUTLINE_REVIEWED.md"):
        rv = _read(planning / fname)
        if not rv:
            continue
        # spelled-out or digit counts: "five claims", "6 claims", "four Parts"
        words = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}
        cm = re.search(r"\b(\w+|\d+)\s+claims?\b", rv, re.I)
        if cm:
            tok = cm.group(1).lower()
            n = int(tok) if tok.isdigit() else words.get(tok)
            if n is not None and live_claims and n != len(live_claims):
                issues.append(f"{fname} asserts {n} claims but live OUTLINE.md has {len(live_claims)} "
                              f"({', '.join(sorted(live_claims))}) — re-approve before trusting APPROVED.")
        pm = re.search(r"\b(\w+|\d+)\s+(substantive\s+)?Parts?\b", rv, re.I)
        if pm:
            tok = pm.group(1).lower()
            n = int(tok) if tok.isdigit() else words.get(tok)
            if n is not None and live_parts and n != live_parts:
                issues.append(f"{fname} asserts {n} Parts but live OUTLINE.md has {live_parts} — "
                              f"the approved review predates the current structure.")
    return issues


def build_index(project_or_planning: Path) -> IndexResult:
    planning = _planning_dir(project_or_planning)
    root = _project_root(planning)
    res = IndexResult()
    res.style = _style(planning)

    # resolved paths (so the index is a complete data artifact the engines consume directly)
    if (planning / "PRECIS.md").is_file():
        res.precis_path = str((planning / "PRECIS.md").resolve())
    if (planning / "OUTLINE.md").is_file():
        res.outline_path = str((planning / "OUTLINE.md").resolve())
    bib = root / "references" / "sources.bib"
    if bib.is_file():
        res.bib_path = str(bib.resolve())
    else:
        other = sorted((root / "references").glob("*.bib")) if (root / "references").is_dir() else []
        other = other or sorted(root.glob("*.bib"))
        if other:
            res.bib_path = str(other[0].resolve())

    outline_md = _read(planning / "OUTLINE.md")
    if not outline_md:
        res.violations.append("No .planning/OUTLINE.md found.")
        return res

    order = _structure_order(outline_md)
    if not order:
        res.violations.append("OUTLINE.md has no `## Structure` block with `### Section` headings.")
        return res

    roman = _roman_to_part(order)
    primary_map = _claim_section_map(outline_md, roman)
    outdir, draftdir = root / "outlines", root / "drafts"

    for i, name in enumerate(order):
        outline_file, draft_file = _pair_files(name, outdir, draftdir)
        outline_text = _read(Path(outline_file)) if outline_file else ""
        fm = _frontmatter(_read(Path(draft_file))) if draft_file else {}
        implements = fm.get("implements", [])
        primary = sorted(primary_map.get(name, set()), key=lambda c: int(c.split("-")[1]))
        granular, note = _granularity(outline_text)
        # sources_pinned is ADVISORY + OUTLINE-based: does the outline pin a real SOURCE
        # (a pandoc [@key]) to its claims — the question the draft phase consumer asks
        # ("if false, the draft agent assigns citations from the bib"). A bare CLAIM-XX is
        # a claim id, NOT a source, so it does NOT count. This deliberately differs from a
        # draft-body reading (does the finished prose cite) — a different, also-valid
        # measurement we do not gate on. The field drives nothing; it never fails parity.
        # ⚠ CAVEAT (tender-parity): on LEGAL outlines [@key] is uniformly absent — they pin
        # sources in Bluebook PROSE (§262, "Williams Act", "See …"), so this returns false
        # for sourced legal sections. If sourcesPinned EVER goes load-bearing it needs a
        # Bluebook-aware signal; until then it stays advisory and non-discriminating on
        # legal projects is acceptable.
        sources_pinned = bool(_CITEKEY_RE.search(outline_text))
        claim_ok = set(primary).issubset(set(implements))  # ⊇ semantics (D-w-3)

        if outline_file is None:
            res.violations.append(f"Section '{name}': no outline file in {outdir} "
                                  f"(tried '{name}.md' and '{name} (Outline).md').")
        if not granular:
            res.violations.append(f"Section '{name}': not granular — {note}.")
        if primary and not claim_ok:
            missing = sorted(set(primary) - set(implements))
            res.violations.append(f"Section '{name}': draft.implements missing primary claim(s) "
                                  f"{missing} (map assigns {primary}; draft has {implements}).")

        res.sections.append(Section(
            name=name, order=i, outline_file=outline_file, draft_file=draft_file,
            primary_claims=primary, implements=implements, sources_pinned=sources_pinned,
            granular=granular, granularity_note=note,
            prev_name=order[i - 1] if i > 0 else "",
            next_name=order[i + 1] if i < len(order) - 1 else "",
            claim_ok=claim_ok,
        ))

    res.stale_approval = _stale_approval(planning, outline_md, res.sections)
    return res


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: writing_section_index.py /abs/project[/.planning]", file=sys.stderr)
        return 2
    res = build_index(Path(sys.argv[1]))
    print(json.dumps(res.to_dict(), indent=2, ensure_ascii=False))
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
