#!/usr/bin/env python3
"""The page-offset gate, asserted against real PDFs.

    python3 skills/pincite/tests/test_page_offset.py [--corpus /path/to/opv]

Every case below is a measured offset on a paper in the OPV corpus, and the
corpus is read-only. The eight KNOWN_GOOD rows are the regression guard: they
were derived correctly before the corroboration route existed and must still be.
The three remaining rows are the ones that made the route necessary --

  fisch1994   a right answer the dominance threshold refused (15 votes of 42,
              runner-up 7, so `hits >= 3 * runner_up` failed)
  choi2009    a scan whose folios are almost all gone from the text layer; the
              modal offset is 23, six hundred pages wrong
  choi2010    the same, modal offset 30

-- and the rule the test enforces is that a wrong offset is worse than no
offset: a REJECT passes, an offset that is neither correct nor rejected fails.

Exits 0 on pass, 1 on a real failure, 0 with a message when the corpus is absent.
"""
import argparse
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'scripts'))
import pincite as P  # noqa: E402

# citekey -> (bib start page, the TRUE offset, or None when no offset is derivable)
#
# The truths are read off the PDFs, not copied from a ticket: choi2009 and
# choi2010 are HeinOnline scans whose page 1 is a Hein cover and whose page 2 is
# the article's first printed page, giving 649-2 = 647 and 869-2 = 867 -- not
# the 645/865 a first guess suggests.
KNOWN_GOOD = {
    'iliev2015': 445, 'brav2022': 491, 'cai2009': 2388, 'manne1964': 1425,
    'fisch2023': -1, 'black1990': 518, 'thomas2012': 1211, 'malenko2016': 3393,
}
MUST_ACCEPT = {'fisch1994': 1008}
# Correct or refused, never a third thing. Accepting 23 or 30 is a failure.
CORRECT_OR_REJECT = {'choi2009': 647, 'choi2010': 867}


def bib_start_of(text, key):
    m = re.search(r'@\w+\{' + re.escape(key) + r',(.*?)\n\}', text, re.S)
    pm = re.search(r'\bpages\s*=\s*\{+\s*(\d+)', m.group(1)) if m else None
    return int(pm.group(1)) if pm else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', default='/home/eh/projects/opv',
                    help='manuscript repo holding the fixture PDFs (read-only)')
    ap.add_argument('--vision', action='store_true',
                    help='also assert the vision fallback on the row the text route '
                         'refuses (needs GOOGLE_API_KEY; costs API calls, so opt-in -- '
                         'the gate itself must not depend on a network)')
    a = ap.parse_args()

    root = pathlib.Path(a.corpus)
    P.ROOT = root
    P.BIB = root / 'paper/references/sources.bib'
    if not P.BIB.exists():
        print(f'SKIP: no corpus at {root} (pass --corpus); '
              'the fixtures are paywalled PDFs and are not vendored into this repo')
        return 0

    bib = P.bib_index()
    bibtext = P.BIB.read_text()
    fails, lines = [], []

    def check(key, want, allow_reject):
        entry = bib.get(key)
        if not entry or not entry[0].exists():
            fails.append(f'{key}: no PDF on disk ({entry[0] if entry else "no bib entry"})')
            return
        start = bib_start_of(bibtext, key)
        off = P.page_offset(P.pages_of(entry[0]), start)
        got = off['k'] if off['accepted'] else None
        verdict = ('REJECT' if got is None
                   else 'ACCEPT' if got == want else f'ACCEPT {got}')
        lines.append(f'  {key:12s} bib {str(start):>5s}  want {want:>5d}  '
                     f'{verdict:<12s} conf {off["confidence"]}  '
                     f'{off["route"] or off["reason"]}')
        if got == want:
            return
        if got is None and allow_reject:
            return
        fails.append(f'{key}: expected offset {want}'
                     f'{" or a REJECT" if allow_reject else ""}, got '
                     f'{"REJECT: " + off["reason"] if got is None else got}')

    print('regression -- offsets that already worked must not move:')
    for key, want in KNOWN_GOOD.items():
        check(key, want, allow_reject=False)
    print('\n'.join(lines)); lines.clear()

    print('\nweak signal, RIGHT answer -- must now be accepted:')
    for key, want in MUST_ACCEPT.items():
        check(key, want, allow_reject=False)
    print('\n'.join(lines)); lines.clear()

    print('\nweak signal, WRONG modal answer -- correct or refused, never 23 or 30:')
    refused = []
    for key, want in CORRECT_OR_REJECT.items():
        before = len(fails)
        check(key, want, allow_reject=True)
        if len(fails) == before and 'REJECT' in lines[-1]:
            refused.append((key, want))
    print('\n'.join(lines)); lines.clear()

    if a.vision:
        import os
        vkey = os.environ.get('GOOGLE_API_KEY')
        print('\nvision fallback on what the text route refused:')
        if not vkey:
            fails.append('--vision passed but GOOGLE_API_KEY is unset')
        for key, want in refused:
            pdf = bib[key][0]
            v = P.vision_offset(pdf, len(P.pages_of(pdf)), bib_start_of(bibtext, key), vkey)
            got = v['k'] if v and v['accepted'] else None
            print(f'  {key:12s} want {want:>5d}  '
                  f'{"ACCEPT" if got == want else "REJECT" if got is None else f"ACCEPT {got}"}'
                  f'  {v["reason"] if v else "no probe"}')
            if got is not None and got != want:
                fails.append(f'{key}: vision returned {got}, not {want}')
        if not refused:
            print('  (nothing refused -- the text route resolved every row)')

    if fails:
        print(f'\nFAIL ({len(fails)}):')
        for f in fails:
            print(f'  {f}')
        return 1
    print(f'\nPASS: {len(KNOWN_GOOD) + len(MUST_ACCEPT) + len(CORRECT_OR_REJECT)} offsets')
    return 0


if __name__ == '__main__':
    sys.exit(main())
