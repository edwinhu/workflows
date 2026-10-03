"""UNCALIBRATED -- not wired. Parked 2026-10-02 after a second pass (diagnosis row 6).

First pass: violating twin 0.75/0.79, then 0.51-0.59 with a stricter wording. Second pass, same twins:
a script cannot decide it -- a stemmed-overlap threshold low enough to catch the twin (0.75 of the
subtitle's terms, 4 new words) also fires on 18 accepted slides across the colloquium, corps and secreg
decks. This extractor (closed-list flags; only slides whose first line adds no number, quotation or
citation, reason or example are listed; the second body line withheld) took the twin from 0.55/0.56 to
0.85/0.87 and 0.87/0.86 on two `rule-calibrate --runs 2` invocations, compliant 0.00, real 0.07-0.28:
a pass at the bar, short of the 0.90 margin. A word-for-word synonym paraphrase scored only 0.90-0.92,
so the ceiling is Jev's, not the twin's. Accepted work also breaks the written rule: the full Tornetta
deck (colloquium 0779d15, line 1597) opens "Would SB 21 change anything?" with "The first closing
question: would SB 21 change anything?", 0.80-0.88 alone and 0.39 diluted among the deck's 13 listed
slides. Wiring needs the user's ruling on that slide plus a judge that clears paraphrase with margin.
"""
"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: violating fixture never reached 0.85: 0.75/0.79 with the first wording, 0.51/0.56 with the stricter one; compliant and real <= 0.28.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, clip, in_changed, kind_note, scope_note, slides, typ_files

PROPOSITION = ('For at least one listed slide, first_body_line says the same thing as its subtitle in other '
               'words: a reader who has just read the subtitle learns nothing new from first_body_line.')

CRITERIA = {
    'VIOLATED': "some listed slide's first body line makes the same claim as its subtitle",
    'SATISFIED': "every listed slide's first body line makes a different claim from its subtitle",
    'NOT_APPLICABLE': 'the state lists no slide',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

STOP = set('the a an is are of for in to and or not that this its by on be must may can does do has have but '
           'from with under at each only if how what when which than also it as was were their they them there '
           'then so into over about more most no nor yet who whom whose will would should could just very'.split())
SUFFIX = ('ations', 'ation', 'ments', 'ment', 'ings', 'ing', 'ers', 'er', 'ies', 'es', 'ed', 'ly', 's', 'e')
QUOTE = re.compile(r'["“”]|#quote|#highlight|\b[Vv]\.\s|§|\(\d{4}\)|\bsupra\b|\bId\.')
REASON = re.compile(r'\b(because|since|so that|so|therefore|thus|hence|unless|only if|which means|leads? to|'
                    r'causes?|results? in|by|through)\b|→|-->|=>', re.IGNORECASE)
EXAMPLE = re.compile(r'\b(e\.g\.|for example|for instance|such as|including)\b', re.IGNORECASE)


def _stem(w):
    for suf in SUFFIX:
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            return w[:-len(suf)][:6]
    return w[:6]


def _terms(s):
    """{stem: first surface form} of the content words: function words and markup calls dropped, so
    'recommends' and 'recommendation' are one term."""
    out = {}
    for w in re.findall(r'[a-z0-9]+', re.sub(r'#\w+', ' ', s).lower()):
        if w not in STOP and len(w) > 2:
            out.setdefault(_stem(w), w)
    return out


def evidence(files, plan_lines=None, changed=None):
    pairs, skipped = [], 0
    for rel, a in typ_files(files, 'deck'):
        lines = _read(a)
        if lines is None:
            continue
        for s in slides(lines):
            if DQ_TITLE.match(s['title']) or not s['body']:
                continue
            first_n = s['body'][0][0]
            if not in_changed(changed, rel, s['line'], first_n):
                skipped += 1
                continue
            title, first = s['title'], s['body'][0][1]
            tt, ft = _terms(title), _terms(first)
            echoed = [tt[k] for k in tt if k in ft]
            new_nums = set(re.findall(r'\d+', first)) - set(re.findall(r'\d+', title))
            pairs.append({'file': rel, 'line': s['line'], 'subtitle': clip(title),
                          'first_body_line': {'line': first_n, 'text': clip(first)},
                          'subtitle_terms_repeated': echoed[:12],
                          'share_of_subtitle_terms_repeated': round(len(echoed) / len(tt), 2) if tt else 0.0,
                          'first_line_terms_not_in_subtitle': [ft[k] for k in ft if k not in tt][:15],
                          'adds_number': bool(new_nums),
                          'quotes_or_cites_source': bool(QUOTE.search(first)),
                          'adds_reason_or_consequence': bool(REASON.search(first)),
                          'adds_example': bool(EXAMPLE.search(first))})
    n_all = len(pairs)
    pairs = [p for p in pairs if not (p['adds_number'] or p['quotes_or_cites_source'] or p['adds_reason_or_consequence'] or p['adds_example'])]
    pairs.sort(key=lambda p: -p['share_of_subtitle_terms_repeated'])
    inventory = {
        **kind_note(files, 'deck'),
        'slides_subtitle_and_first_body_line': pairs[:MAX_ITEMS],
        'n_slides': n_all, 'n_slides_listed': len(pairs), 'listing_note': 'only slides whose first_body_line adds no number, no quotation or citation, no reason or consequence and no example are listed',
        'term_note': 'terms are content words after dropping function words and folding word forms '
                     '(recommends = recommendation); the flags are closed-list regex checks on first_body_line',
        **scope_note(changed, skipped),
    }
    return render_json('T-ECHO', files, inventory, [])
