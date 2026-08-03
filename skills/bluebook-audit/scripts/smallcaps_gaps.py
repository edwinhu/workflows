#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["lxml"]
# ///
"""Report periodical names that are MISSING small caps, found by citation shape.

Neither of the obvious sources is complete:

  * a fixed journal-name list (bluebook-audit's `JOURNAL_NAMES`) only knows the
    periodicals someone thought to add — it misses `J. Corp. L.`;
  * `sources.bib` only has a `journal` field for entries Gemini classified as
    `@article`. `J. Corp. L.` appears nowhere in the bib for exactly that
    reason, so a bib-driven pass misses it too.

What IS reliable is the shape of a Bluebook periodical citation:

    <volume> <PERIODICAL NAME> <first page> (<year>)

That is structural, so it finds periodicals nobody has enumerated. The bib's
`journal` values are then used only to CONFIRM hits, never to limit them.

Two exclusions matter, both from Bluebook typeface rules rather than guesswork:

  * case reporters (`U.S.`, `F.3d`, `S. Ct.`, `A.2d` …) match the same shape but
    are set roman — Rule 10;
  * `Fed. Reg.` and other regulatory material are roman — Rule 14.

Reports only. Applying is a separate, reviewed step: an over-eager small-caps
pass silently restyles case cites, and a reader cannot tell that from a fixed
document.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import zipfile
from collections import defaultdict
from copy import deepcopy
from io import BytesIO
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docx_footnotes import QW, build_fn_table, display_to_id, load_parts

# <volume> <NAME> <page> (<year>)
CITE = re.compile(
    r"\b(\d{1,4})\s+"
    r"([A-Z][A-Za-z.&'’\-]*(?:\s+[A-Za-z.&'’\-]+){0,6}?)\s+"
    r"(\d{1,5})(?:,\s*\d+)?\s*\((?:[A-Z][a-z]+\.?\s+\d+,\s*)?(\d{4})\)"
)

# Roman under Bluebook: case reporters (R.10) and regulatory material (R.14).
ROMAN = re.compile(
    r"^(U\.?\s?S\.?|F\.\s?\d?d?|F\.\s?Supp\.?\s?\d?d?|S\.\s?Ct\.|L\.\s?Ed\.|"
    r"A\.\s?\d?d|N\.E\.\s?\d?d|N\.W\.\s?\d?d|P\.\s?\d?d|So\.\s?\d?d|"
    r"S\.E\.\s?\d?d|S\.W\.\s?\d?d|Cal\.\s?Rptr\.|Fed\.\s?Reg\.|"
    r"Stat\.|U\.S\.C\.|C\.F\.R\.|B\.R\.|Del\.\s?Ch\.)",
    re.IGNORECASE)


def bib_journals(bib: Path) -> set[str]:
    if not bib.is_file():
        return set()
    s = bib.read_text(errors='ignore')
    out = set()
    for _t, _k, body in re.findall(r'@(\w+)\{([^,]+),(.*?)\n\}', s, re.S):
        m = re.search(r'^\s*journal\s*=\s*\{+(.*?)\}+,?\s*$', body, re.M)
        if m:
            out.add(m.group(1).strip())
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--docx', required=True)
    ap.add_argument('--bib', type=Path,
                    default=Path('paper/references/sources.bib'))
    ap.add_argument('--apply', action='store_true',
                    help='small-cap the reported names (run-splitting)')
    ap.add_argument('--output')
    a = ap.parse_args()

    known = bib_journals(a.bib)
    p = load_parts(a.docx)
    tbl = build_fn_table(p['document'], p['footnotes'])
    i2d = {v: k for k, v in display_to_id(tbl).items()}

    hits: dict[str, list] = defaultdict(list)
    for fn in p['footnotes'].findall(QW('footnote')):
        disp = i2d.get(int(fn.get(QW('id'))))
        if disp is None:
            continue
        # walk runs, tracking which are already small caps
        for r in fn.iter(QW('r')):
            text = ''.join(t.text or '' for t in r.iter(QW('t')))
            if not text:
                continue
            rpr = r.find(QW('rPr'))
            if rpr is not None and rpr.find(QW('smallCaps')) is not None:
                continue                     # already styled
            for m in CITE.finditer(text.replace('\xa0', ' ')):
                name = m.group(2).strip()
                if ROMAN.match(name):
                    continue
                if not re.search(r'[A-Z]', name) or len(name) < 3:
                    continue
                hits[name].append((disp, m.group(0)[:60]))

    print(f'bib journal names available for confirmation: {len(known)}\n')
    print(f'{"periodical":<28}{"in bib?":<10}{"fns"}')
    print('-' * 68)
    total = 0
    for name in sorted(hits, key=lambda n: (-len(hits[n]), n)):
        fns = sorted({d for d, _ in hits[name]})
        mark = 'yes' if name in known else 'NOT IN BIB'
        print(f'{name[:27]:<28}{mark:<10}{fns}')
        total += len(fns)
    print(f'\n{len(hits)} distinct periodical(s), {total} occurrence(s) lacking small caps')
    if not a.apply or not hits:
        return 0

    # Apply: split each containing run into prefix + name + suffix, deepcopy the
    # source rPr so nothing else about the run changes, and add smallCaps to the
    # middle piece only. Same discipline as bluebook-audit's applier.
    W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    XS = '{http://www.w3.org/XML/1998/namespace}space'
    def qw(t): return f'{{{W}}}{t}'

    src = a.docx
    dst = a.output or a.docx
    with zipfile.ZipFile(src) as z:
        names_z = z.namelist()
        raw = {n: z.read(n) for n in names_z}
        infos = {i.filename: i for i in z.infolist()}
    fns = etree.parse(BytesIO(raw['word/footnotes.xml'])).getroot()

    def mk(txt, rpr, sc):
        r = etree.Element(qw('r'))
        if rpr is not None:
            nr = deepcopy(rpr)
            if sc and nr.find(qw('smallCaps')) is None:
                nr.insert(0, etree.Element(qw('smallCaps')))
            r.append(nr)
        elif sc:
            rp = etree.SubElement(r, qw('rPr'))
            etree.SubElement(rp, qw('smallCaps'))
        t = etree.SubElement(r, qw('t'))
        t.set(XS, 'preserve')
        t.text = txt
        return r

    wanted = set(hits)
    applied = 0
    for fn in fns.findall(qw('footnote')):
        changed = True
        while changed:                     # re-scan: a split creates new runs
            changed = False
            for para in fn.findall(qw('p')):
                for r in para.findall(qw('r')):
                    txt = ''.join(t.text or '' for t in r.findall(qw('t')))
                    if not txt:
                        continue
                    rpr = r.find(qw('rPr'))
                    if rpr is not None and rpr.find(qw('smallCaps')) is not None:
                        continue
                    for nm in sorted(wanted, key=len, reverse=True):
                        pat = re.escape(nm).replace(r'\ ', r'[\s\xa0]')
                        m = re.search(pat, txt)
                        if not m:
                            continue
                        idx = list(para).index(r)
                        new = []
                        if txt[:m.start()]:
                            new.append(mk(txt[:m.start()], rpr, False))
                        new.append(mk(txt[m.start():m.end()], rpr, True))
                        if txt[m.end():]:
                            new.append(mk(txt[m.end():], rpr, False))
                        para.remove(r)
                        for i, nr2 in enumerate(new):
                            para.insert(idx + i, nr2)
                        applied += 1
                        changed = True
                        break
                    if changed:
                        break
                if changed:
                    break

    print(f'\napplied small caps to {applied} occurrence(s)')
    if Path(dst) != Path(src):
        shutil.copy2(src, dst)
    tmp = str(dst) + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zo:
        for n in names_z:
            data = raw[n]
            if n == 'word/footnotes.xml':
                data = etree.tostring(fns, xml_declaration=True,
                                      encoding='UTF-8', standalone=True)
            zo.writestr(infos[n], data)
    Path(tmp).replace(dst)
    print(f'wrote {dst}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
