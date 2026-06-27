#!/usr/bin/env -S uv run python3
"""Regression: a law-review paper with NO author acknowledgements must NOT get a `*` author
footnote (and the footnote-repair must NOT assume 3 bios). Root cause of the tender-paper bug:
build_docx auto-filled a LOREM placeholder acknowledgement → a spurious `*` footnote that
collided with the real numbered footnotes; fix_footnotes then defaulted to 3 bios and stamped
*,†,‡ on real footnotes 1-3.

Run: uv run python3 tests/test_law_review_footnote_symbols.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills" / "law-review-docx" / "scripts"))
import build_docx as bd  # noqa: E402

_p = _f = 0


def ok(name, cond, extra=""):
    global _p, _f
    if cond:
        _p += 1; print(f"  ok  {name}")
    else:
        _f += 1; print(f"FAIL  {name} {extra}")


def proj(aw_body: str) -> Path:
    d = Path(tempfile.mkdtemp())
    (d / ".planning").mkdir()
    (d / ".planning" / "ACTIVE_WORKFLOW.md").write_text(aw_body)
    return d


# 1. No acknowledgements → acknowledgements stays "" (NO LOREM placeholder → no `*` footnote)
m = bd.parse_metadata(proj('---\nworkflow: writing\nstyle: legal\ntitle: "T"\nauthor: "Edwin Hu"\n---\n'))
ok("no-acks: acknowledgements is empty (LOREM placeholder removed)", m["acknowledgements"] == "", repr(m["acknowledgements"]))
ok("no-acks: no LOREM text leaked in", "Lorem" not in m["acknowledgements"] and "placeholder" not in m["acknowledgements"].lower())
ok("no-acks: author_acks empty", m["author_acks"] == [])

# 2. Real acknowledgement set → preserved (a legit `*` author footnote WILL be injected)
m2 = bd.parse_metadata(proj('---\nworkflow: writing\ntitle: "T"\nauthor: "Edwin Hu"\nacknowledgements: "Thanks to colleagues."\n---\n'))
ok("with-acks: acknowledgement preserved", m2["acknowledgements"] == "Thanks to colleagues.")

# 3. Multi-author author_ack_N → parsed (legit *,† bios)
m3 = bd.parse_metadata(proj(
    '---\nworkflow: writing\ntitle: "T"\nauthor: "A* & B†"\n'
    'author_ack_1: "Prof, X."\nauthor_ack_2: "Prof, Y."\n---\n'))
ok("multi-author: 2 author_acks parsed", [a for a in m3["author_acks"] if a] == ["Prof, X.", "Prof, Y."], repr(m3["author_acks"]))

# 4. LOREM constant is gone from the module (no placeholder mechanism left)
ok("LOREM constant removed from build_docx", not hasattr(bd, "LOREM"))

# 5. fix_footnotes no longer hardcodes 3 bios — default is auto-detect (None)
import importlib.util  # noqa: E402
fp = ROOT / "skills" / "docx-repair" / "scripts" / "fix_footnotes.py"
src = fp.read_text()
ok("fix_footnotes --bio-footnotes default is auto-detect (not 3)",
   'default=None' in src and 'customMarkFollows="1"' in src and 'auto-detect' in src.lower())
ok("fix_footnotes guards numbering-offset on zero bios",
   "if bio_count <= 0:" in src)

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
