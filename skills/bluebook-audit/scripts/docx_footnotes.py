#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["lxml"]
# ///
"""Footnote primitives: display numbering, bookmarks, and run tokenization.

The bluebook-audit `audit_crossref_targets.py` resolves NOTEREF bookmarks and
greps for first cites, but it works entirely in *xml footnote ids* and only
sees references that are ALREADY fields.  Two things this paper needs that it
does not provide:

  1. **Display numbers.**  A reader (and Nadya's comments) talk about "footnote
     151", which is the *rendered* number.  Author-bio footnotes carry
     ``customMarkFollows`` and are skipped by Word's counter, so xml id order
     and display number diverge.  Every verdict has to be reported in display
     numbers or it cannot be checked by a human.

  2. **Literal and hybrid references.**  ``supra note 149`` typed as plain text
     is invisible to a field-only scan.  Worse is the *hybrid* — a NOTEREF
     field followed by a literal digit, which renders correctly today and
     silently changes the moment anyone presses F9.

So this module linearizes each paragraph into a token stream that distinguishes
field refs, literal refs, and hybrids, and maps every footnote to its display
number.
"""
from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from io import BytesIO

from lxml import etree

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def QW(t): return f"{{{W}}}{t}"


# ── package I/O ─────────────────────────────────────────────────────────

def load_parts(docx: str, names=('document', 'footnotes', 'comments')) -> dict:
    out = {}
    with zipfile.ZipFile(docx) as zf:
        have = set(zf.namelist())
        for n in names:
            p = f'word/{n}.xml'
            if p in have:
                out[n] = etree.parse(BytesIO(zf.read(p))).getroot()
    return out


# ── footnote numbering ──────────────────────────────────────────────────

@dataclass
class FnInfo:
    fn_id: int                 # xml w:id
    display: int | None        # rendered number; None for bio/custom-mark notes
    custom_mark: bool
    text: str


def footnote_order(doc: etree._Element) -> list[tuple[int, bool]]:
    """Footnote ids in *document order*, with each ref's customMarkFollows flag.

    Word numbers footnotes by the order their reference marks appear in the
    body, not by their order in footnotes.xml, and it does not advance the
    counter for a reference whose mark is custom (the ``*``/``†``/``‡`` bios).
    """
    out: list[tuple[int, bool]] = []
    for ref in doc.iter(QW('footnoteReference')):
        fid = ref.get(QW('id'))
        if fid is None:
            continue
        custom = ref.get(QW('customMarkFollows')) == '1'
        out.append((int(fid), custom))
    return out


def build_fn_table(doc: etree._Element, fns: etree._Element) -> dict[int, FnInfo]:
    """Map every footnote id to its display number and full text."""
    texts = {}
    for fn in fns.findall(QW('footnote')):
        fid = fn.get(QW('id'))
        if fid is None:
            continue
        texts[int(fid)] = ''.join(t.text or '' for t in fn.iter(QW('t')))

    table: dict[int, FnInfo] = {}
    counter = 0
    for fid, custom in footnote_order(doc):
        if custom:
            disp = None
        else:
            counter += 1
            disp = counter
        table[fid] = FnInfo(fn_id=fid, display=disp, custom_mark=custom,
                            text=texts.get(fid, ''))
    # footnotes present in footnotes.xml but never referenced (separators, id<1)
    for fid, txt in texts.items():
        table.setdefault(fid, FnInfo(fn_id=fid, display=None, custom_mark=False, text=txt))
    return table


def display_to_id(table: dict[int, FnInfo]) -> dict[int, int]:
    return {i.display: i.fn_id for i in table.values() if i.display is not None}


# ── bookmarks ───────────────────────────────────────────────────────────

def bookmark_to_fnid(doc: etree._Element) -> dict[str, int]:
    """Resolve every ``_Ref*`` bookmark to the footnote id its range wraps.

    A bookmark can span runs, so walk forward from bookmarkStart to the
    matching bookmarkEnd (by w:id) across the whole body, not just siblings.
    """
    out: dict[str, int] = {}
    starts: dict[str, str] = {}   # bookmark w:id -> name
    open_ids: set[str] = set()
    pending: dict[str, int | None] = {}

    for el in doc.iter():
        tag = etree.QName(el).localname
        if tag == 'bookmarkStart':
            bid = el.get(QW('id'))
            name = el.get(QW('name'), '')
            if bid is None:
                continue
            starts[bid] = name
            open_ids.add(bid)
            pending.setdefault(name, None)
        elif tag == 'bookmarkEnd':
            bid = el.get(QW('id'))
            open_ids.discard(bid)
        elif tag == 'footnoteReference':
            fid = el.get(QW('id'))
            if fid is None:
                continue
            for bid in open_ids:
                name = starts.get(bid, '')
                if name and pending.get(name) is None:
                    pending[name] = int(fid)
    for name, fid in pending.items():
        if fid is not None:
            out[name] = fid
    return out


# ── reference tokenization ──────────────────────────────────────────────

REF_RE = re.compile(r'NOTEREF\s+(\S+)')


@dataclass
class Token:
    kind: str          # 'text' | 'field'
    text: str = ''     # for 'text': the literal; for 'field': its cached display
    bookmark: str = ''
    start: int = 0     # offset in the linearized string
    end: int = 0
    # xml handles for surgery
    nodes: list = field(default_factory=list)


def linearize(p: etree._Element) -> tuple[str, list[Token]]:
    """Flatten a paragraph to text plus a token map.

    Field results (the cached number Word shows) are emitted as their literal
    text so offsets line up with what a reader sees, but tagged as 'field' with
    the bookmark name, so a scan can tell "149" that is a live field from "149"
    that someone typed.
    """
    buf: list[str] = []
    toks: list[Token] = []
    pos = 0
    state = 'body'           # body | instr | result
    instr: list[str] = []
    cur_bm = ''
    cur_nodes: list = []
    cur_txt: list[str] = []
    depth = 0

    def flush_field():
        nonlocal pos, cur_bm, cur_nodes, cur_txt
        s = ''.join(cur_txt)
        toks.append(Token('field', s, cur_bm, pos, pos + len(s), list(cur_nodes)))
        buf.append(s)
        pos += len(s)
        cur_bm, cur_nodes, cur_txt = '', [], []

    for el in p.iter():
        tag = etree.QName(el).localname
        if tag == 'fldChar':
            ft = el.get(QW('fldCharType'))
            if ft == 'begin':
                depth += 1
                if depth == 1:
                    state, instr, cur_txt, cur_nodes = 'instr', [], [], [el]
                else:
                    cur_nodes.append(el)
            elif ft == 'separate':
                if depth == 1:
                    m = REF_RE.search(''.join(instr))
                    cur_bm = m.group(1) if m else ''
                    state = 'result'
                cur_nodes.append(el)
            elif ft == 'end':
                cur_nodes.append(el)
                depth -= 1
                if depth == 0:
                    if not cur_bm:
                        m = REF_RE.search(''.join(instr))
                        cur_bm = m.group(1) if m else ''
                    flush_field()
                    state = 'body'
        elif tag == 'instrText':
            if state == 'instr':
                instr.append(el.text or '')
            cur_nodes.append(el)
        elif tag == 't':
            if state == 'body':
                s = el.text or ''
                toks.append(Token('text', s, '', pos, pos + len(s), [el]))
                buf.append(s)
                pos += len(s)
            else:
                if state == 'result':
                    cur_txt.append(el.text or '')
                cur_nodes.append(el)
    return ''.join(buf), toks


SUPRA_SCAN = re.compile(
    r'(?P<lead>[^.;]{0,200}?)'
    r',?\s*(?P<kind>[Ss]upra|[Ii]nfra)\s+notes?\s*(?P<num>[\d–—\-\s&,and]{1,24})'
)


def token_at(toks: list[Token], lo: int, hi: int) -> list[Token]:
    return [t for t in toks if t.start < hi and t.end > lo]


def classify_number(toks: list[Token], lo: int, hi: int) -> tuple[str, list[str]]:
    """Classify the number span of a supra reference.

    Returns (kind, bookmarks) where kind is one of:
      'field'   — entirely a NOTEREF field result
      'literal' — entirely typed text
      'hybrid'  — a field with literal digits welded on (the F9 landmine)
    """
    spans = token_at(toks, lo, hi)
    if not spans:
        return 'literal', []
    kinds = {t.kind for t in spans}
    bms = [t.bookmark for t in spans if t.kind == 'field' and t.bookmark]
    if kinds == {'field'}:
        return 'field', bms
    if kinds == {'text'}:
        return 'literal', []
    # mixed: only a landmine if the literal part carries digits
    lit_digits = any(
        re.search(r'\d', t.text[max(0, lo - t.start):hi - t.start])
        for t in spans if t.kind == 'text'
    )
    return ('hybrid' if lit_digits else 'field'), bms
