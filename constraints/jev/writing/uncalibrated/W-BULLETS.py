"""UNCALIBRATED -- not wired. Calibration 2026-10-02: live Jev scored an accepted passage (docs/DESIGN-third-party-review.md, a 4-item
numbered list of settled questions) 0.87 twice (wiring needs < 0.5).
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _prose

import re

from _common import render_json
from _prose import paragraphs, prose_files, prose_search

DELIVERABLE = 'prose'

PROPOSITION = ('An argument is chopped into bullet points where it should be prose: a list whose '
               'items are full sentences that depend on one another -- reasons that build, steps of '
               'one argument, a claim and its qualification -- rather than parallel, separable items '
               '(a list of documents, dates, parties, defined terms or requested actions).')

CRITERIA = {
    'VIOLATED': 'at least one list carries a connected argument whose items lean on each other',
    'SATISFIED': 'every list holds parallel, separable items, or the document has no lists',
    'NOT_APPLICABLE': 'the state holds no prose at all',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

LIST_RX = r'^\s*(?:[-*+]|\d+[.)])\s+'
CONNECTIVE_RX = re.compile(r'^(but|and|so|because|therefore|thus|this|that|these|it|they|which|'
                           r'however|moreover|further|as a result|in turn|hence)\b', re.IGNORECASE)


def evidence(files, plan_lines=None):
    paras = paragraphs(files)
    lists = []
    for k, p in enumerate(paras):
        if p['kind'] != 'list':
            continue
        items = [t for _, t in p['sentences']]
        prev = paras[k - 1] if k > 0 and paras[k - 1]['file'] == p['file'] else None
        lists.append({
            'file': p['file'], 'line': p['line'], 'n_items': len(items),
            'lead_in': prev['sentences'][-1][1][:250] if prev and prev['sentences'] else None,
            'items': [t[:220] for t in items[:12]],
            'mean_words_per_item': round(sum(len(t.split()) for t in items) / max(1, len(items)), 1),
            'items_opening_on_a_connective': sum(bool(CONNECTIVE_RX.match(t)) for t in items),
        })
    inventory = {
        'lists': lists[:20],
        'n_lists': len(lists),
        'n_prose_paragraphs': sum(p['kind'] == 'para' for p in paras),
    }
    s = prose_search(files, r'^(but|so|because|therefore|thus|hence|as a result)\b',
                     'sentences or items that open on a connective')
    return render_json('W-BULLETS', prose_files(files), inventory, [s])
