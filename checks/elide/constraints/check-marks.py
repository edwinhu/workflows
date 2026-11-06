#!/usr/bin/env python3
"""The editing marks of an addendum, decided from the .typ alone.

Usage: check-marks.py <addendum.typ>
       check-marks.py --project-dir P [--plan X] [--files F ...]   (the constraint contract:
                      each .typ handed in, as checks/elide/constraints/_elide_contract.py runs it)

Three checks, each a FAIL naming the line:

  elision    ONE elision mark per addendum (editing-marks.md). Every bracketed ellipsis
             spelling is counted -- `[. . .]`, `[...]`, `[…]`, `[ . . . ]` -- and more than
             one spelling in the same file FAILS. An unbracketed `. . .` is the court's own
             and is not counted.
  footnotes  per reading, every retained footnote is renumbered and paired: the `#super[N]`
             markers in the court's text, in order of first appearance, are exactly 1..k,
             each has a body `N. ...` in that reading's footnote block (`*[Retained
             footnote]*`, a `#line(length: ...)` rule, or an `*ENDNOTES*` heading), and each
             body has a marker. A marker left at its original number (`#super[16]`), a marker
             with no body, and a body with no marker all FAIL. Typst's own `#footnote[...]`
             numbers itself and is only counted.
  summaries  every editorial summary is `#emph[[Summary: ...]]` on one line (editing-marks.md):
             F1 no other wrapping of a summary label, F2 at most 40 words, F3 between sentences
             or a paragraph of its own, F4 no elision mark beside it (it IS the mark), F5 no
             double quotation mark, F6 no currency, percent or million/billion figure, F7 no
             holding word (held, ruled, concluded, ...), F8 in a reading's body only -- never the
             preamble or an editors' note. A summary is not an elision spelling for the first leg.

Exit 0 when all three hold, 1 when any fails, 2 on a usage error.
"""
import contextlib
import io
import re
import sys
from pathlib import Path

import _summary

CAPTION_RE = re.compile(r'#text\(\s*13pt\s*,\s*weight:\s*"bold"\s*\)\s*\[([^\]]+)\]')
ELISION_RE = re.compile(r'\[\s*(?:\.\s*){3,4}\]|\[\s*(?:…|\\u\{2026\})\s*\]')
SUPER_RE = re.compile(r'#super\[\s*(\d+)\s*\]')
ZONE_RE = re.compile(r'^\s*\*\[\s*Retained footnote|^\s*#line\(\s*length|^\s*\*\s*(?:END|FOOT)?NOTES\s*\*\s*$', re.IGNORECASE)
BODY_RE = re.compile(r'^\s*(\d+)\.\s+\S')
NOTE_RE = re.compile(r"Editors(?:['’]|\\u\{2019\})?\s+note", re.IGNORECASE)
SMALL_RE = re.compile(r'^\s*#text\(\s*(?:9|10)pt\s*\)\s*\[')
SENT_END_RE = re.compile(r'[.!?]["”’\')_*]*$')
SENT_START_RE = re.compile(r'^[A-Z0-9"“‘\'(\[_*#]')
QUOTE_RE = re.compile(r'["“”]|\\u\{201[cCdD]\}')
FIGURE_RE = re.compile(r'(?:\\?\$|€|£)\s*\d|\d\s*%|\bpercent\b|\d[\d,.]*\s*(?:million|billion|trillion)\b', re.IGNORECASE)
HOLDING_RE = re.compile(r'\b(?:held|holds|holding|holdings|ruled|rules that|concluded|concludes|conclusion|'
                        r'finds that|found that)\b', re.IGNORECASE)
FORM = '#emph[[Summary: ...]] on one line'


def spelling(mark: str) -> str:
    return mark.replace('\\u{2026}', '…')


def readings(lines: list[str]) -> list[tuple[str, int, int]]:
    """(title, first line index, end index) per caption block; text before the first is skipped."""
    starts = [(i, m.group(1).strip()) for i, ln in enumerate(lines) if (m := CAPTION_RE.search(ln))]
    return [(t, i, starts[k + 1][0] if k + 1 < len(starts) else len(lines)) for k, (i, t) in enumerate(starts)]


def check_elision(lines: list[str]) -> list[str]:
    seen: dict[str, list[int]] = {}
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith('//'):
            continue
        for m in ELISION_RE.finditer(_summary.mask(ln, ' ')):
            seen.setdefault(spelling(m.group(0)), []).append(i + 1)
    if len(seen) <= 1:
        only = next(iter(seen), None)
        print(f"  elision: PASS — {'one mark, ' + repr(only) + f' x{len(seen[only])}' if only else 'no bracketed elision mark'}")
        return []
    detail = '; '.join(f"{k!r} x{len(v)} (first at line {v[0]})" for k, v in seen.items())
    print(f"  elision: FAIL — {len(seen)} elision marks in one addendum: {detail}")
    return ['elision']


def check_footnotes(lines: list[str]) -> list[str]:
    bad = []
    native = sum(ln.count('#footnote[') for ln in lines)
    rs = readings(lines)
    if not rs:
        # the quotes leg already FAILS an addendum with no reading; this leg has nothing to pair
        print("  footnotes: NOT CHECKED — no caption block, so there is no reading to check")
        return []
    for title, lo, hi in rs:
        markers: list[tuple[int, int]] = []
        bodies: dict[int, int] = {}
        zone = False
        for i in range(lo, hi):
            ln = lines[i]
            if ZONE_RE.search(ln):
                zone = True
                continue
            if zone:
                m = BODY_RE.match(ln)
                if m:
                    bodies.setdefault(int(m.group(1)), i + 1)
                continue
            for m in SUPER_RE.finditer(ln):
                markers.append((int(m.group(1)), i + 1))
        order: list[int] = []
        for n, _ in markers:
            if n not in order:
                order.append(n)
        first = {n: ln for n, ln in reversed(markers)}
        problems = []
        if order != list(range(1, len(order) + 1)):
            problems.append(f"markers run {order}, not 1..{len(order)} — renumber from 1 in order "
                            f"(first out of sequence at line {first[next(n for k, n in enumerate(order) if n != k + 1)]})")
        for n in order:
            if n not in bodies:
                problems.append(f"marker {n} at line {first[n]} has no footnote body — an orphan marker")
        for n, ln in sorted(bodies.items()):
            if n not in first:
                problems.append(f"footnote body {n} at line {ln} has no marker in the text")
        if problems:
            bad.append(title)
            for p in problems:
                print(f"  footnotes [{title}]: FAIL — {p}")
        elif order:
            print(f"  footnotes [{title}]: PASS — {len(order)} retained footnote(s), numbered 1..{len(order)}, each paired")
    if native:
        print(f"  footnotes: {native} native #footnote[...] call(s) — Typst numbers these itself; not checked")
    if bad:
        return ['footnotes']
    print(f"  footnotes: PASS — {len(rs)} reading(s) checked")
    return []


def _depth(s: str) -> int:
    return len(re.findall(r'(?<!\\)\[', s)) - len(re.findall(r'(?<!\\)\]', s))


def note_lines(lines: list[str]) -> set[int]:
    """Indices of editors'-note lines: the line naming the note, and the rest of its open block."""
    out, depth, note = set(), 0, False
    for i, ln in enumerate(lines):
        if depth > 0:
            note = note or bool(NOTE_RE.search(ln))
            if note:
                out.add(i)
            depth += _depth(ln)
            if depth <= 0:
                depth, note = 0, False
        elif NOTE_RE.search(ln):
            out.add(i)
            if _depth(ln) > 0:
                depth, note = _depth(ln), True
        elif SMALL_RE.match(ln) and _depth(ln) > 0:
            depth, note = _depth(ln), False
    return out


def _unescape(t: str) -> str:
    return re.sub(r'\\u\{([0-9a-fA-F]+)\}', lambda m: chr(int(m.group(1), 16)), t)


def _neighbour(lines: list[str], i: int, step: int) -> str:
    j = i + step
    while 0 <= j < len(lines) and not lines[j].strip():
        j += step
    return _summary.mask(lines[j]).strip() if 0 <= j < len(lines) else ''


def check_summaries(lines: list[str]) -> list[str]:
    problems: list[tuple[int, str]] = []
    rs = readings(lines)
    body_from = rs[0][1] + 1 if rs else len(lines)
    notes = note_lines(lines)
    n = 0
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith('//'):
            continue
        for _, got in _summary.loose(ln):
            problems.append((i, f"F1 form: {got.strip()!r} labels a summary outside the one form, {FORM}"))
        for s, e, inner, ok in _summary.spans(ln):
            if not ok:
                problems.append((i, f"F1 form: a #emph[[Summary: opener that does not close as ]] on the same line — {FORM}"))
                continue
            n += 1
            k = len(_summary.words(inner))
            if k > _summary.MAX_WORDS:
                problems.append((i, f"F2 cap: {k} words, more than {_summary.MAX_WORDS}"))
            before = _unescape(_summary.mask(ln[:s])).rstrip()
            after = _unescape(_summary.mask(ln[e:])).lstrip()
            if (before and not SENT_END_RE.search(before)) or (after and not SENT_START_RE.match(after)):
                problems.append((i, "F3 position: inside a sentence — set it between sentences or as a paragraph of its own"))
            if before or after:
                double = bool(re.search(ELISION_RE.pattern + r'\s*$', before) or re.match(ELISION_RE.pattern, after))
            else:
                double = bool(re.search(ELISION_RE.pattern + r'$', _neighbour(lines, i, -1))
                              or re.match(ELISION_RE.pattern, _neighbour(lines, i, 1)))
            if double:
                problems.append((i, "F4 double mark: an elision mark beside the summary — the summary IS the mark; drop the [. . .]"))
            if QUOTE_RE.search(inner):
                problems.append((i, "F5 quotes: a double quotation mark inside — a summary never quotes; the court's words stay in the excerpt"))
            if m := FIGURE_RE.search(inner):
                problems.append((i, f"F6 figure: {m.group(0)!r} — no amount, percent or million/billion figure in a summary"))
            if m := HOLDING_RE.search(inner):
                problems.append((i, f"F7 holding: {m.group(0)!r} — a summary describes what was cut; a holding or rule stays in the court's words"))
            if i < body_from:
                problems.append((i, "F8 placement: in the preamble — a summary belongs in a reading's body, after its caption"))
            elif i in notes:
                problems.append((i, "F8 placement: on an editors'-note line — a summary belongs in the reading's body"))
    for i, p in problems:
        print(f"  summaries: FAIL — line {i + 1}: {p}")
    if problems:
        return ['summaries']
    print(f"  summaries: PASS — {n} editorial summary span(s)" if n else "  summaries: PASS — no editorial summary")
    return []


def check_file(path: Path) -> int:
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as e:
        print(f"FAIL: cannot read {path}: {e}")
        return 2
    failed = check_elision(lines) + check_footnotes(lines) + check_summaries(lines)
    return 1 if failed else 0


def main() -> int:
    if len(sys.argv) != 2:
        print('usage: check-marks.py <addendum.typ>', file=sys.stderr)
        return 2
    return check_file(Path(sys.argv[1]))


def judge(path: Path, ctx: dict) -> tuple[int, list[str], str]:
    from _elide_contract import findings_of
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = check_file(path)
    if m := re.search(r'summaries: PASS — (\d+ editorial summary span\(s\))', buf.getvalue()):
        ctx.setdefault("notes", []).append(f"{path.name}: {m.group(1)}")
    return rc, findings_of(path, buf.getvalue()), buf.getvalue()


if __name__ == '__main__':
    from _elide_contract import run, wanted
    if wanted():
        sys.exit(run('check-marks', lambda p: p.suffix == '.typ', judge, 'addendum(s)', '.typ addendum'))
    sys.exit(main())
