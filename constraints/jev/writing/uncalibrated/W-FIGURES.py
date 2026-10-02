"""UNCALIBRATED -- not wired. Calibration 2026-10-02: live Jev scored its violating fixture 0.71 and 0.68 on a rerun (wiring needs >= 0.85).
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _prose

import re

from _common import render_json
from _prose import paragraphs, prose_files, prose_search, span

DELIVERABLE = 'prose'

PROPOSITION = ('The prose leans on rhetorical figures in place of plain statement: a recurring '
               'manufactured contrast ("not X, but Y", "not just X -- it is Y", "X isn\'t A; it\'s B") '
               'that denies something nobody claimed, or paragraphs that close on a balanced, '
               'aphoristic line restating what the paragraph already said.')

CRITERIA = {
    'VIOLATED': 'two or more candidates are manufactured contrasts or aphoristic closers that add '
                'no claim of their own',
    'SATISFIED': 'contrasts answer a position someone actually holds and paragraph endings carry '
                 'content; at most one figure is decorative',
    'NOT_APPLICABLE': 'the state holds no prose sentences',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

CONTRAST_RX = (r"\bnot (just|only|merely|simply|about)\b|\bnot\b[^.;:]{1,60}[,;:—-]+\s*(but|it'?s|"
               r"it is|rather)\b|\b(isn'?t|aren'?t|wasn'?t|doesn'?t|don'?t|is not|are not|was not|does not|"
               r"do not)\b[^.;]{1,60};\s*(it|they|this)\b|\bless about\b[^.]{1,60}\bmore about\b|"
               r"\bthe question (is|was) not\b")


def evidence(files, plan_lines=None):
    rx = re.compile(CONTRAST_RX, re.IGNORECASE)
    contrasts, closers = [], []
    for p in paragraphs(files):
        if p['kind'] != 'para' or not p['sentences']:
            continue
        for i, (_, t) in enumerate(p['sentences']):
            if rx.search(t):
                contrasts.append(span(p, i))
        if len(p['sentences']) >= 3:
            last = span(p, len(p['sentences']) - 1)
            last['words'] = len(last['sentence'].split())
            closers.append(last)
    inventory = {
        'contrast_candidates': contrasts[:30],
        'n_contrast_candidates': len(contrasts),
        'paragraph_closers': closers[:25],
        'n_paragraphs_of_three_or_more_sentences': len(closers),
    }
    s = prose_search(files, CONTRAST_RX, 'every "not X but Y" / "isn\'t A; it\'s B" contrast')
    return render_json('W-FIGURES', prose_files(files), inventory, [s])
