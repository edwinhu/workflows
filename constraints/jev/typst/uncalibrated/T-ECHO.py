"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: violating fixture never reached 0.85: 0.75/0.79 with the first wording, 0.51/0.56 with the stricter one; compliant and real <= 0.28.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, clip, in_changed, kind_note, scope_note, slides, typ_files

PROPOSITION = ('A slide restates its own subtitle: for at least one listed slide, first_body_line makes the '
               'same claim as the subtitle -- the same subject and the same predicate, reworded or reordered '
               '-- and adds no number, mechanism, example, source or consequence the subtitle lacks. The '
               'audience reads the same point twice. Sharing a few words with the subtitle while adding '
               'something new is not a restatement.')

CRITERIA = {
    'VIOLATED': 'some slide opens its body by paraphrasing its own subtitle',
    'SATISFIED': 'every slide body opens with something the subtitle does not already say',
    'NOT_APPLICABLE': 'the state lists no slide with both a subtitle and a body line',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

STOP = set('the a an is are of for in to and or not that this its by on be must may can does do has have but '
           'from with under at each only if how what when which than also it as was were'.split())


def _words(s):
    return {w for w in re.findall(r'[a-z0-9]+', s.lower()) if w not in STOP and len(w) > 2}


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
            tw = _words(s['title'])
            first = s['body'][0][1]
            shared = sorted(tw & _words(first))
            pairs.append({'file': rel, 'line': s['line'], 'subtitle': clip(s['title']),
                          'first_body_line': {'line': first_n, 'text': clip(first)},
                          'second_body_line': clip(s['body'][1][1], 200) if len(s['body']) > 1 else None,
                          'content_words_shared_with_subtitle': shared[:12],
                          'share_of_subtitle_words': round(len(shared) / len(tw), 2) if tw else 0.0})
    pairs.sort(key=lambda p: -p['share_of_subtitle_words'])
    inventory = {
        **kind_note(files, 'deck'),
        'slides_subtitle_and_first_body_line': pairs[:MAX_ITEMS],
        'n_slides': len(pairs),
        **scope_note(changed, skipped),
    }
    return render_json('T-ECHO', files, inventory, [])
