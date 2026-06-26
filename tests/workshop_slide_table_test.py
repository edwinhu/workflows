#!/usr/bin/env -S uv run python3
"""
Golden tests for scripts/workshop/workshop_slide_table.py — the ONE shared Slide Spec parser.

Mirrors tests/writing_section_index_test.py: a MIXED-FORM fixture block (canonical table +
legacy prose, proving tolerant-at-parser) plus a REAL-REPO parity block at the tail
(build_index on the live ~/projects/opv deck, the blind-oracle target — DESIGN §3 "THE TRAP":
golden-test the strict parser against a REAL hand-emitted deck, never the canonical template).

Run:  uv run python3 tests/workshop_slide_table_test.py
"""

import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "workshop"))
import workshop_slide_table as W  # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"  ✗ {name}")


def write(d: Path, name: str, text: str) -> Path:
    p = d / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ── 1. CANONICAL TABLE form (the EXACT born-canonical emitter format from workshop/SKILL.md Phase 2) ──
# This fixture mirrors the SKILL template byte-for-byte (incl. the "Part N:" section prefix + the
# `==` backtick separator + a parenthetical Visual) so a drift between the emitter and the parser
# (doctrine #6: born-canonical emitter ↔ tolerant parser) is caught here.
TABLE = """## Presentation Outline

Total time: 20 minutes

## Slide Spec (MANDATORY EXECUTABLE TABLE)

| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|-------|---------|----------|---------|-----------|--------|-------|
| 1. Title | Part 1: Motivation `==` The Rise of Proxy Advisors | Proxy advisors emerged to fill a monitoring gap. | ERISA; capacity; ISS arose | A1, R1 | none | Open with the puzzle ~2 min |
| 2. Mechanism | Part 1: Motivation `==` The Rise of Proxy Advisors | One recommendation moves many votes. | robo share; concentration | F1, R2 | F1 (influence chart) | Walk the figure ~3 min |
"""


def test_table():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        write(d, "OUTLINE.md", TABLE)
        idx = W.build_index(d.parent)
        check("table: form=table", idx.form == "table")
        check("table: 2 slides", len(idx.slides) == 2)
        check("table: ok (no SOURCES → no dangling check)", idx.ok)
        s1 = idx.slides[0]
        check("table: takeaway parsed", s1.takeaway == "Proxy advisors emerged to fill a monitoring gap.")
        check("table: inventory tokens", s1.inventory == ["A1", "R1"])
        check("table: visual carried (none)", s1.visual == "none")
        check("table: parenthetical visual carried", idx.slides[1].visual == "F1 (influence chart)")
        check("table: notes carried (pinned, not inferred)", s1.notes.startswith("Open with the puzzle"))
        check("table: section split off `==` with Part prefix",
              s1.section == "Part 1: Motivation" and s1.subsection == "The Rise of Proxy Advisors")


# ── 2. LEGACY PROSE form (the real opv shape) ───────────────────────────────────
PROSE = """## Presentation Outline

### Part 1: Setup (~3 minutes, 3 slides)
= Motivation & Background

== About the Speaker
- Slide: "This is a paper I didn't plan to write." — SEC experience → [A1, A2]

== The Debate
- Slide: "The real question is not 'do funds follow ISS?' but 'are they judging?'" — roadmap → [A3]

### Appendix (Q&A backup)
= Appendix

== Data
- Slide: "Key findings from the data." — Summary of R1-R8 → [R1-R8]
"""


def test_prose():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        write(d, "OUTLINE.md", PROSE)
        idx = W.build_index(d.parent)
        check("prose: form=prose", idx.form == "prose")
        check("prose: 3 slides", len(idx.slides) == 3)
        check("prose: ok (4-field subset, Visual/Notes NOT required)", idx.ok)
        check("prose: Visual empty (not a violation)", idx.slides[0].visual == "")
        check("prose: apostrophe survives in takeaway",
              idx.slides[0].takeaway == "This is a paper I didn't plan to write.")
        check("prose: inner single-quotes survive",
              "'do funds follow ISS?'" in idx.slides[1].takeaway)
        check("prose: over-attach FIX — [R1-R8] → endpoints, not expanded",
              idx.slides[2].inventory == ["R1", "R8"])
        check("prose: sections in document order",
              idx.section_order == ["Motivation & Background", "Appendix"])


# ── 3. Violations: title-only garbage (no inventory) blocks ──────────────────────
TITLE_ONLY = """## Presentation Outline
= Motivation
== Intro
- Slide: "Some title with no sources."
"""


def test_title_only_blocks():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        write(d, "OUTLINE.md", TITLE_ONLY)
        idx = W.build_index(d.parent)
        check("title-only: NOT ok (missing inventory is a violation)", not idx.ok)
        check("title-only: violation names the missing inventory",
              any("inventory id" in v.lower() for v in idx.violations))


# ── 4. Dangling inventory ref vs SOURCES.md ──────────────────────────────────────
def test_dangling_ref():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        write(d, "OUTLINE.md", PROSE)
        write(d, "SOURCES.md", "### Figures\n- **F1:** x\n### Results\n- **R1:** y\n### Args\n- **A1:** z\n- **A2:** w\n- **A3:** q\n")
        idx = W.build_index(d.parent)
        # R8, T?, F? absent → dangling
        check("dangling: detected (R8 not in SOURCES)",
              any("R8" in v and "not found" in v for v in idx.violations))


# ── 5. Stale-approval backstop (DESIGN §5) ───────────────────────────────────────
def test_stale_approval():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        write(d, "OUTLINE.md", PROSE)  # 3 slides, 2 sections
        write(d, "OUTLINE_APPROVED.md", "---\nstatus: APPROVED\nslide_count: 9\nsection_count: 4\n---\n")
        idx = W.build_index(d.parent)
        check("stale: slide_count mismatch flagged",
              any("slide_count=9" in s and "has 3" in s for s in idx.stale_approval))
        check("stale: section_count mismatch flagged",
              any("section_count=4" in s and "has 2" in s for s in idx.stale_approval))


# ── 6. Unicode-safe slug (em-dash sections) ──────────────────────────────────────
def test_slug_unicode():
    s = W.section_slug("Part II — The Two Offer-Period Channels")
    check("slug: unicode-safe (em-dash → dash, no crash)", "—" not in s and s == unicodedata.normalize("NFC", s))
    check("slug: collapses to word-dashes", "Part-II" in s and "Channels" in s)


# ── 7. REAL-REPO PARITY (THE TRAP — golden against the live opv deck, not the template) ──
def test_real_opv():
    opv = Path.home() / "projects" / "opv" / ".planning" / "OUTLINE.md"
    if not opv.is_file():
        print("  (skip real-opv parity — ~/projects/opv/.planning/OUTLINE.md absent)")
        return
    idx = W.build_index(opv)
    check("opv: form=prose (real deck is prose, NOT a table)", idx.form == "prose")
    check("opv: 21 slides (opv-parity ground truth)", len(idx.slides) == 21)
    check("opv: 5 sections (= headings)", len(idx.section_order) == 5)
    check("opv: ok — the prose deck PARSES CLEAN (parity-regression fix)", idx.ok)
    check("opv: every slide has ≥1 inventory id", all(s.inventory for s in idx.slides))
    check("opv: every slide has a takeaway", all(s.takeaway for s in idx.slides))
    # the over-attach fix on the real S21 "Key findings" row
    kf = [s for s in idx.slides if "Key findings" in s.takeaway]
    check("opv: S21 over-attach FIX — [R1-R8] → ['R1','R8']", bool(kf) and kf[0].inventory == ["R1", "R8"])
    # paperPath expanded (no leading ~ — a subagent Read("~/...") would not tilde-expand)
    check("opv: paperPath is expanded absolute (no leading ~)",
          idx.paper_path.startswith("/") and not idx.paper_path.startswith("~"))


# ── 8. STRUCTURE-REORDER PAUSE FIXTURE (DESIGN §5 / Step 6 — workshop's grain-pause analog) ──
# A spec-changing editorial decision (reorder/re-scope) was honored in the live OUTLINE while the
# upstream OUTLINE_APPROVED.md still encodes the OLD shape. The deterministic backstop must catch the
# stale approval and route to a PAUSE (re-approve), never silently trust the stale APPROVED.
def test_reorder_pause_fixture():
    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / ".planning"
        # v1 was approved at 2 Parts / 2 slides; the live OUTLINE was then reorganised to 3 Parts / 4 slides.
        reorganised = """## Presentation Outline
= Part A
== Intro
- Slide: "A." — b → [A1]
= Part B
== Mid
- Slide: "B." — b → [R1]
= Part C
== New section added in the reframe
- Slide: "C." — b → [T1]
- Slide: "D." — b → [A1]
"""
        write(d, "OUTLINE.md", reorganised)
        write(d, "OUTLINE_APPROVED.md", "---\nstatus: APPROVED\nslide_count: 2\nsection_count: 2\n---\n")
        idx = W.build_index(d.parent)
        check("reorder: live OUTLINE parses (4 slides / 3 sections)",
              len(idx.slides) == 4 and len(idx.section_order) == 3)
        check("reorder: NOT a hard violation (the reframe itself is legitimate)", not idx.violations)
        check("reorder: stale approval CAUGHT (slide_count 2 vs live 4)",
              any("slide_count=2" in s and "has 4" in s for s in idx.stale_approval))
        check("reorder: stale approval CAUGHT (section_count 2 vs live 3)",
              any("section_count=2" in s and "has 3" in s for s in idx.stale_approval))
        # ok stays True (parses) but stale_approval is non-empty → the skill/guard routes to a re-approve PAUSE.
        check("reorder: ok=True (parses) yet stale_approval flags the re-approve PAUSE", idx.ok and bool(idx.stale_approval))


def main():
    for t in (test_table, test_prose, test_title_only_blocks, test_dangling_ref,
              test_stale_approval, test_slug_unicode, test_reorder_pause_fixture, test_real_opv):
        t()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed" + ("" if FAIL == 0 else f"  ({FAIL} FAILED)"))
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
