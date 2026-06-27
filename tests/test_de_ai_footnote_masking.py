#!/usr/bin/env -S uv run --with pyyaml python3
"""Tests for de_ai_audit.py footnote masking — findings must never land inside a footnote
(pandoc inline ^[...] or markdown [^id]: definitions), since footnotes/citations are off-limits
to a de-AI rewrite. Run: uv run --with pyyaml python3 tests/test_de_ai_footnote_masking.py"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills" / "de-ai-revise" / "scripts"))
import de_ai_audit as d  # noqa: E402

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


# 'tapestry' is an always_flag diction word → flagged on EVERY occurrence (no cluster threshold).
BODY_L1 = "The market is a rich tapestry of incentives."          # line 1 — body, MUST flag
FN_INLINE = "A claim with a note.^[This tapestry sits in a footnote [@smith2019].]"  # line 3 — footnote, must NOT flag
REF_DEF = "[^x]: A reference footnote about a tapestry."          # line 5 — footnote def, must NOT flag
REF_CONT = "    continued tapestry text, indented."              # line 6 — continuation, must NOT flag
BODY_L8 = "A final tapestry in the body."                         # line 8 — body, MUST flag
TEXT = "\n".join([BODY_L1, "", FN_INLINE, "", REF_DEF, REF_CONT, "", BODY_L8]) + "\n"

# ── masking preserves structure ──
masked = d.mask_footnotes(TEXT)
ok("line count preserved", len(masked.split("\n")) == len(TEXT.split("\n")))
ok("inline ^[...] blanked", "tapestry sits in a footnote" not in masked)
ok("[^id]: def blanked", "reference footnote about a tapestry" not in masked)
ok("indented continuation blanked", "continued tapestry text" not in masked)
ok("body line 1 intact", "rich tapestry of incentives" in masked)
ok("body line 8 intact", "final tapestry in the body" in masked)
ok("the [^x]: marker column offsets preserved (still line 5)",
   masked.split("\n")[4].startswith(" ") and len(masked.split("\n")[4]) == len(REF_DEF))

# ── audit: with masking, only BODY tapestry flags (lines 1 + 8), never footnote lines ──
res = d.audit_text(TEXT, mask_fn=True)
tap_lines = sorted({s["line"] for s in res["spans"] if s.get("text", "").lower() == "tapestry"})
ok("masked: tapestry flagged ONLY on body lines 1 & 8", tap_lines == [1, 8], str(tap_lines))
ok("masked: no finding on footnote lines 3/5/6",
   not any(s["line"] in (3, 5, 6) for s in res["spans"]), str([s["line"] for s in res["spans"]]))

# ── --keep-footnotes: footnote occurrences DO surface (proves masking is what suppresses them) ──
res_keep = d.audit_text(TEXT, mask_fn=False)
tap_keep = sorted({s["line"] for s in res_keep["spans"] if s.get("text", "").lower() == "tapestry"})
ok("keep-footnotes: tapestry also flagged on footnote lines 3 & 5",
   3 in tap_keep and 5 in tap_keep, str(tap_keep))
ok("masking strictly reduces findings", len(res["spans"]) < len(res_keep["spans"]))

# ── nested-cite footnote: ^[text [@a; @b] more] fully masked (one level of nested [...]) ──
nested = "Body.^[See *Id.* [@a2019]; cf. [@b2020], at 5 — a tapestry.]\n"
mn = d.mask_footnotes(nested)
ok("nested-bracket footnote fully masked", "tapestry" not in mn and "@a2019" not in mn)
ok("nested-cite body prefix intact", mn.startswith("Body."))

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
