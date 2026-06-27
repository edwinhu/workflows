#!/usr/bin/env -S uv run python3
"""Tests for scripts/writing/writing_section_index.py — the deterministic section-index
parser (the writing analog of ds_plan_table.py).

Run:  uv run python3 tests/writing_section_index_test.py
Exits 0 iff all pass. Self-contained: uses tests/fixtures/writing-section-index plus the
real tender_offers repo when present (skipped otherwise).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "writing"))

import writing_section_index as wsi  # noqa: E402

FIX = ROOT / "tests" / "fixtures" / "writing-section-index"

_passed = 0
_failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ok  {name}")
    else:
        _failed += 1
        print(f"FAIL  {name}{(' — ' + detail) if detail else ''}")


# ── fixture: the happy path with all the real-repo tricky cases ──────────────────
res = wsi.build_index(FIX)
by = {s.name: s for s in res.sections}

check("style read from ACTIVE_WORKFLOW", res.style == "legal", res.style)
check("ok=True (no blocking violations)", res.ok, str(res.violations))
check("5? no — 4 sections discovered", len(res.sections) == 4, str(len(res.sections)))

# document order from `## Structure`, not lexical
order = [s.name for s in res.sections]
check("document order from ## Structure",
      order == ["Introduction", "Part I. The Setup — Foundations",
                "Part II — The Core Channels", "Conclusion"], str(order))

# prev/next threading
check("prev/next ends are empty",
      by["Introduction"].prev_name == "" and by["Conclusion"].next_name == "")
check("prev/next interior",
      by["Part II — The Core Channels"].prev_name == "Part I. The Setup — Foundations"
      and by["Part II — The Core Channels"].next_name == "Conclusion")

# tolerant filename pairing: Part I uses "(Outline)" suffix; others use bare "<Name>.md"
check("tolerant outline pairing: bare <Name>.md",
      by["Introduction"].outline_file is not None
      and by["Introduction"].outline_file.endswith("Introduction.md"))
check("tolerant outline pairing: (Outline) suffix",
      by["Part I. The Setup — Foundations"].outline_file is not None
      and by["Part I. The Setup — Foundations"].outline_file.endswith("(Outline).md"))
check("draft pairing: (Draft) suffix, em-dash safe",
      by["Part II — The Core Channels"].draft_file is not None
      and by["Part II — The Core Channels"].draft_file.endswith("(Draft).md"))

# claim → section map: PRIMARY home only
check("primary claims from map: Part I = {01}",
      by["Part I. The Setup — Foundations"].primary_claims == ["CLAIM-01"])
check("primary claims from map: Part II = {02,03}",
      by["Part II — The Core Channels"].primary_claims == ["CLAIM-02", "CLAIM-03"])
check("primary claims: Intro/Concl echo-only = {}",
      by["Introduction"].primary_claims == [] and by["Conclusion"].primary_claims == [])

# ⊇ semantics: claimOk = draft.implements ⊇ primary (NOT equality, NOT draft ⊆ outline)
check("claimOk True: superset (Intro surveys all, primary {})",
      by["Introduction"].claim_ok is True)
check("claimOk True: Part I draft {01,02} ⊇ primary {01}",
      by["Part I. The Setup — Foundations"].claim_ok is True
      and by["Part I. The Setup — Foundations"].implements == ["CLAIM-01", "CLAIM-02"])
check("claimOk True: Part II exact match still ⊇",
      by["Part II — The Core Channels"].claim_ok is True)

# stale-approval: PRECIS_REVIEWED says 4 claims, live has 3 → flagged; 2 Parts matches → not flagged
check("stale approval: claim-count mismatch surfaced",
      any("4 claims" in m and "3" in m for m in res.stale_approval), str(res.stale_approval))
check("stale approval: matching Part count NOT falsely flagged",
      not any("Parts" in m for m in res.stale_approval), str(res.stale_approval))

# sourcesPinned advisory + outline-based: [@key] present ⇒ true; bare CLAIM-XX does NOT count
check("sourcesPinned true where outline has [@key]",
      by["Part I. The Setup — Foundations"].sources_pinned is True)
check("sourcesPinned false where outline has only CLAIM-XX, no [@key]",
      by["Part II — The Core Channels"].sources_pinned is False)


# ── granularity floor: placeholder + bare-headings bounce ────────────────────────
g_ok, _ = wsi._granularity("- a\n- b\n- c\n")
check("granular: 3 bullets passes", g_ok is True)
g_tba, note_tba = wsi._granularity("# Sec\n- TBA — develop this section\n- b\n- c\n")
check("granular=False on placeholder (TBA)", g_tba is False and "TBA" in note_tba.upper())
g_bare, note_bare = wsi._granularity("# Sec\n## A\n## B\n")
check("granular=False on bare headings", g_bare is False and "bare-headings" in note_bare)


# ── ⊇ direction negative: draft MISSING a primary claim must fail (not pass) ──────
with tempfile.TemporaryDirectory() as td:
    proj = Path(td)
    (proj / ".planning").mkdir()
    (proj / "outlines").mkdir()
    (proj / "drafts").mkdir()
    (proj / ".planning" / "ACTIVE_WORKFLOW.md").write_text("---\nstyle: econ\n---\n")
    (proj / ".planning" / "OUTLINE.md").write_text(
        "## Structure\n\n### Part I. Alpha\n- a\n- b\n- c\n\n"
        "## Claim → Section Map\n| Claim | Primary home | x |\n|--|--|--|\n"
        "| CLAIM-01 | I.A | - |\n| CLAIM-02 | I.A | - |\n")
    (proj / "outlines" / "Part I. Alpha.md").write_text("- **A** point\n- **B** point\n- **C** point\n")
    # draft implements only 01, but map assigns {01,02} → claimOk must be False
    (proj / "drafts" / "Part I. Alpha (Draft).md").write_text("---\nimplements: [CLAIM-01]\n---\nx\n")
    r2 = wsi.build_index(proj)
    s2 = r2.sections[0]
    check("⊇ negative: missing primary claim ⇒ claimOk False",
          s2.claim_ok is False and "CLAIM-02" in str(r2.violations))
    check("style econ read", r2.style == "econ")


# ── real-repo smoke (skipped if absent): assert INVARIANTS, not mutable contents ──────
# NB: tender_offers/paper is a LIVE repo that gets restructured (section count/names/claim
# count change as the paper is revised). Asserting an exact section list here is brittle and
# false-fails whenever the author edits the paper. So check only the parser INVARIANTS that
# must hold for ANY well-formed writing project; the exact-contents oracle lives in the
# committed fixture above (writing-section-index), which is stable.
REAL = Path.home() / "projects" / "tender_offers" / "paper"
if (REAL / ".planning" / "OUTLINE.md").is_file():
    rr = wsi.build_index(REAL)
    n = len(rr.sections)
    check("[real] build_index returns sections", n >= 3, f"got {n}")
    check("[real] document order is contiguous 0..n-1",
          [s.order for s in rr.sections] == list(range(n)))
    check("[real] ends have empty prev/next, interiors don't",
          n >= 2 and rr.sections[0].prev_name == "" and rr.sections[-1].next_name == ""
          and all(rr.sections[i].prev_name for i in range(1, n)))
    # Pairing is REPO-STATE-dependent: a WIP repo mid-revision may have ## Structure headings the
    # outline/draft filenames don't yet match (the parser CORRECTLY surfaces that drift as unpaired
    # — it's not a parser bug). So assert only that the pairing fields are well-formed (str|None),
    # and LOG the paired count rather than requiring all-paired.
    check("[real] pairing fields well-formed (str|None)",
          all((s.outline_file is None or isinstance(s.outline_file, str))
              and (s.draft_file is None or isinstance(s.draft_file, str)) for s in rr.sections))
    paired = sum(1 for s in rr.sections if s.outline_file and s.draft_file)
    print(f"  -- [real] {paired}/{n} sections fully paired (informational; WIP repos drift)")
    check("[real] ⊇ claim gate holds for every section", all(s.claim_ok for s in rr.sections),
          str([s.name for s in rr.sections if not s.claim_ok]))
    # stale_approval is state-dependent (true iff a *_REVIEWED predates the live structure) — it is
    # a LIST (possibly empty); assert only that the field is well-formed, never a specific count.
    check("[real] stale_approval is a well-formed list", isinstance(rr.stale_approval, list))
else:
    print("  -- real tender_offers repo absent; smoke check skipped")


print(f"\n{_passed} passed, {_failed} failed")
sys.exit(1 if _failed else 0)
