#!/usr/bin/env python3
"""The editing marks of an addendum, decided from the .typ alone.

Usage: check-marks.py <addendum.typ>

Two checks, each a FAIL naming the line:

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

Exit 0 when both hold, 1 when either fails, 2 on a usage error.
"""
import re
import sys
from pathlib import Path

CAPTION_RE = re.compile(r'#text\(\s*13pt\s*,\s*weight:\s*"bold"\s*\)\s*\[([^\]]+)\]')
ELISION_RE = re.compile(r'\[\s*(?:\.\s*){3,4}\]|\[\s*(?:…|\\u\{2026\})\s*\]')
SUPER_RE = re.compile(r'#super\[\s*(\d+)\s*\]')
ZONE_RE = re.compile(r'^\s*\*\[\s*Retained footnote|^\s*#line\(\s*length|^\s*\*\s*(?:END|FOOT)?NOTES\s*\*\s*$', re.IGNORECASE)
BODY_RE = re.compile(r'^\s*(\d+)\.\s+\S')


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
        for m in ELISION_RE.finditer(ln):
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


def main() -> int:
    if len(sys.argv) != 2:
        print('usage: check-marks.py <addendum.typ>', file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as e:
        print(f"FAIL: cannot read {path}: {e}")
        return 2
    failed = check_elision(lines) + check_footnotes(lines)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
