"""UNCALIBRATED -- not wired. Parked 2026-10-02 (diagnosis row 6). The paraphrase half of the retired
T-ECHO: the typst plugin's no-subtitle-echo.py (typst 2f541df) owns the lexical half, so only the pairs
it passes are listed (no exact echo; under 3 shared words or under half the subtitle's words), and of
those only the ones whose first line adds no number, quotation or citation, reason or example. It scores
0.00 on T-ECHO's lexical cases, so the two never grade one pair.

State, measured on the twins (probe, 2-3 runs each): the shared-word list, the closed-list note and the
counts beside the share pulled vio to 0.43-0.66; the share alone plus a selection note gave 0.93-0.96.
Two `rule-calibrate --runs 2` invocations on the final code: vio 0.96/0.95, 0.91/0.93; sat 0.12-0.17;
real decks (charter, nevada, tornetta-short, landscape opening, tornetta record) 0.00-0.23; legacy-base
bad cases tornetta 0.87/0.85, 0.86/0.90 and held-out nevada 0.89/0.88, 0.89/0.87 -- under the 0.90
margin; charter bad2 0.75/0.70, 0.72/0.71 (FAIL), its first try bad/ 0.48/0.47; ok cases up to 0.36.
Cross-rule 0.61-0.62 on T-CALLOUT's legacy tornetta bad, an added slide that opens on content.
A second round (no scope note; "restates ... with no fact, party, condition or consequence") moved no
bad case above 0.89 and lifted the ok cases to 0.34-0.51. Jev reads a clean paraphrase as the same claim
only when the words map one to one (the twin); a paraphrase that generalizes a term ("the strictest
standard of review" for "entire fairness") is read as new content.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, clip, in_changed, kind_note, scope_note, slides, typ_files

PROPOSITION = ('For at least one listed slide, first_body_line makes the same claim as its subtitle in '
               'other words and adds nothing to it: a reader who has just read the subtitle learns nothing '
               'new from first_body_line.')

CRITERIA = {
    'VIOLATED': "some listed slide's first body line makes the same claim as its subtitle",
    'SATISFIED': "every listed slide's first body line makes a different claim from its subtitle",
    'NOT_APPLICABLE': 'the state lists no slide',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

# no-subtitle-echo.py's own word test, copied so the two never grade the same pair.
SCRIPT_STOP = set('the a an is are of for in to and or not that this its by on be must may can does do has '
                  'have but from with under at each only if how what when which than also'.split())
SCRIPT_RATIO, SCRIPT_COUNT = 0.5, 3
QUOTE = re.compile(r'["“”]|#quote|#highlight|\b[Vv]\.\s|§|\(\d{4}\)|\bsupra\b|\bId\.')
REASON = re.compile(r'\b(because|since|so that|so|therefore|thus|hence|unless|only if|which means|leads? to|'
                    r'causes?|results? in|by|through)\b|→|-->|=>', re.IGNORECASE)
EXAMPLE = re.compile(r'\b(e\.g\.|for example|for instance|such as|including)\b', re.IGNORECASE)


def _norm(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', s.lower())).strip()


def _sig(s):
    return {w for w in re.sub(r'[^\w\s]', '', s.lower()).split() if w not in SCRIPT_STOP and len(w) > 2}


def script_overlap(title, first):
    """(shared words, share of the subtitle's words, flagged) as no-subtitle-echo.py computes them."""
    tw, fw = _sig(title), _sig(first)
    shared = tw & fw
    share = len(shared) / len(tw) if tw else 0.0
    emph = re.match(r'^[*_]+(.+?)[*_]+', first)
    exact = bool(emph) and _norm(emph.group(1)) == _norm(title)
    return sorted(shared), share, exact or (share >= SCRIPT_RATIO and len(shared) >= SCRIPT_COUNT)


# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'


def evidence(files, plan_lines=None, changed=None):
    pairs, skipped, n_lines = [], 0, 0
    for rel, a in typ_files(files, 'deck'):
        lines = _read(a)
        if lines is None:
            continue
        n_lines += len(lines)
        for s in slides(lines):
            if DQ_TITLE.match(s['title']) or not s['body']:
                continue
            first_n, first = s['body'][0]
            if not in_changed(changed, rel, s['line'], first_n):
                skipped += 1
                continue
            _, share, flagged = script_overlap(s['title'], first)
            if flagged:
                continue
            if (set(re.findall(r'\d+', first)) - set(re.findall(r'\d+', s['title']))
                    or QUOTE.search(first) or REASON.search(first) or EXAMPLE.search(first)):
                continue
            pairs.append({'file': rel, 'line': s['line'], 'subtitle': clip(s['title']),
                          'first_body_line': {'line': first_n, 'text': clip(first)},
                          'script_overlap_share': round(share, 2)})
    # Withheld on measurement (docstring): the shared words, the closed lists and their counts.
    inventory = {
        'n_lines_searched': n_lines,
        **kind_note(files, 'deck'),
        'slides_subtitle_and_first_body_line': pairs[:MAX_ITEMS],
        'n_slides_listed': len(pairs),
        'selection_note': 'listed slides are those the word-overlap script (no-subtitle-echo.py) passes; their '
                          'word overlap is below its threshold, which is why they reach this rule',
        **scope_note(changed, skipped),
    }
    return render_json('T-ECHO-PARA', typ_files(files, 'deck'), inventory, [])
