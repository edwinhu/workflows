#!/usr/bin/env -S uv run python3
"""Regression: a law-review paper with NO author acknowledgements must NOT get a `*` author
footnote (and the footnote-repair must NOT assume 3 bios). Root cause of the tender-paper bug:
build_docx auto-filled a LOREM placeholder acknowledgement → a spurious `*` footnote that
collided with the real numbered footnotes; fix_footnotes then defaulted to 3 bios and stamped
*,†,‡ on real footnotes 1-3.

Run: uv run python3 tests/test_law_review_footnote_symbols.py
"""
from __future__ import annotations

import re
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

# ── 6-9. Regression: the repair must not invent bios or double the pStyle ──
# Root cause of the mirror-paper bug: fix_footnotes picked bio footnotes
# POSITIONALLY ("the first 3 in footnotes.xml"), but pandoc serializes the
# author notes LAST even though their ids are 2/3/4 — so *,†,‡ were stamped on
# ordinary body footnotes, whose <w:footnoteRef/> auto-numbers were destroyed.
# And the pStyle insert only looked at the FIRST child of <w:pPr>, so pandoc's
# `<w:pPr><w:widowControl/><w:pStyle .../></w:pPr>` got a SECOND pStyle.
spec = importlib.util.spec_from_file_location("fix_footnotes", fp)
ff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ff)

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

# Pandoc's real shape: bios are ids 2/3/4, referenced FIRST in the body, but
# written LAST in footnotes.xml. Body footnotes 25/26/27 come first in the part.
DOC = (f'<?xml version="1.0"?><w:document {W}><w:body>'
       '<w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
       '<w:footnoteReference w:customMarkFollows="1" w:id="2"/>'
       '<w:sym w:font="Symbol" w:char="F02A"/></w:r>'
       '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
       '<w:footnoteReference w:customMarkFollows="1" w:id="3"/><w:t>†</w:t></w:r>'
       '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
       '<w:footnoteReference w:customMarkFollows="1" w:id="4"/><w:t>‡</w:t></w:r>'
       '<w:r><w:footnoteReference w:id="25"/></w:r>'
       '<w:r><w:footnoteReference w:id="26"/></w:r>'
       '<w:r><w:footnoteReference w:id="27"/></w:r>'
       '</w:p></w:body></w:document>')


def _body_fn(i):
    return (f'<w:footnote w:id="{i}"><w:p><w:pPr><w:widowControl/>'
            '<w:pStyle w:val="FootnoteText" /></w:pPr>'
            '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
            '<w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Body.</w:t></w:r>'
            '</w:p></w:footnote>')


def _bio_fn(i, glyph):
    return (f'<w:footnote w:id="{i}"><w:p><w:pPr><w:widowControl/>'
            '<w:pStyle w:val="FootnoteText" /></w:pPr>'
            '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
            f'{glyph}</w:r><w:r><w:t xml:space="preserve"> Prof.</w:t></w:r>'
            '</w:p></w:footnote>')


FN = (f'<?xml version="1.0"?><w:footnotes {W}>'
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
      '<w:footnote w:type="continuationSeparator" w:id="0">'
      '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
      + _body_fn(25) + _body_fn(26) + _body_fn(27)
      + _bio_fn(2, '<w:sym w:font="Symbol" w:char="F02A"/>')
      + _bio_fn(3, '<w:t>†</w:t>') + _bio_fn(4, '<w:t>‡</w:t>')
      + '</w:footnotes>')

# 6. bio ids come from the customMarkFollows refs, NOT from document position
ok("bio ids read off customMarkFollows refs (not positional)",
   ff.bio_footnote_ids(DOC, 3) == ["2", "3", "4"],
   repr(ff.bio_footnote_ids(DOC, 3)))
ok("bio ids empty when the paper has no bios",
   ff.bio_footnote_ids(DOC, 0) == [])

# 7. Google Docs fallback: every ref flipped to "0" → first N in body order
DOC_DAMAGED = DOC.replace('customMarkFollows="1"', 'customMarkFollows="0"')
ok("GDocs-damaged fallback still finds the bios",
   ff.bio_footnote_ids(DOC_DAMAGED, 3) == ["2", "3", "4"],
   repr(ff.bio_footnote_ids(DOC_DAMAGED, 3)))

# 8. No stray *,†,‡ on body footnotes; their auto-numbers survive
doc_out, fn_out, _ = ff.restore_bio_custom_marks(DOC, FN, 3)
for fid in ("25", "26", "27"):
    body = re.search(rf'<w:footnote w:id="{fid}">.*?</w:footnote>', fn_out, re.S).group(0)
    ok(f"body footnote {fid} gets no author symbol",
       "F02A" not in body and "†" not in body and "‡" not in body, body[:200])
    ok(f"body footnote {fid} keeps its <w:footnoteRef/> auto-number",
       "footnoteRef" in body)
for fid, glyph in (("2", "F02A"), ("3", "†"), ("4", "‡")):
    body = re.search(rf'<w:footnote w:id="{fid}">.*?</w:footnote>', fn_out, re.S).group(0)
    ok(f"bio footnote {fid} keeps its custom mark", glyph in body, body[:200])
ok("bio refs in document.xml unchanged in id set",
   re.findall(r'customMarkFollows="1" w:id="(\d+)"', doc_out) == ["2", "3", "4"],
   repr(re.findall(r'customMarkFollows="1" w:id="(\d+)"', doc_out)))

# 9. Exactly one <w:pStyle> per <w:pPr>, and it is the first child
fn_styled, _ = ff.fix_footnotes_xml(FN, 3)
dupes = re.findall(r'<w:pPr>(?:(?!</w:pPr>).)*?<w:pStyle(?:(?!</w:pPr>).)*?<w:pStyle',
                   fn_styled, re.S)
ok("no <w:pPr> carries two <w:pStyle> elements", not dupes, f"{len(dupes)} doubled")
ok("FootnoteText reassigned to FNStyleBest despite `\" />`\" spacing",
   'w:val="FootnoteText"' not in fn_styled and fn_styled.count('w:val="FNStyleBest"') == 6,
   fn_styled.count('w:val="FNStyleBest"'))
ok("pStyle is the first child of every footnote pPr",
   not re.search(r'<w:pPr><w:(?!pStyle)[^>]*>(?:(?!</w:pPr>).)*?<w:pStyle', fn_styled, re.S))

print(f"\n{_p} passed, {_f} failed")
sys.exit(1 if _f else 0)
