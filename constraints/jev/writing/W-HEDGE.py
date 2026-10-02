import re

from _common import render_json
from _prose import paragraphs, prose_files, prose_search, span

DELIVERABLE = 'prose'

PROPOSITION = ('The prose hedges more than its evidence warrants: a sentence stacks two or more '
               'hedges on one claim ("may potentially", "could arguably suggest", "it seems that '
               'this might"), or hedges a point the document itself treats as settled. One hedge on '
               'a genuinely open question is calibration, not a violation.')

CRITERIA = {
    'VIOLATED': 'at least one sentence stacks hedges on a single claim, or hedges a claim the '
                'surrounding text states as established',
    'SATISFIED': 'each claim carries at most one hedge, and every hedge sits on a point the text '
                 'treats as open',
    'NOT_APPLICABLE': 'the state holds no prose sentences',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

HEDGES = [r'may', r'might', r'could', r'possibly', r'perhaps', r'arguably', r'potentially',
          r'likely', r'unlikely', r'somewhat', r'seems?', r'seemingly', r'appears?', r'apparently',
          r'suggests?', r'to some (extent|degree)', r'in some (sense|ways?)', r'tends? to',
          r'relatively', r'presumably', r'conceivably', r'it is possible', r'generally']
HEDGE_RX = r'\b(' + '|'.join(HEDGES) + r')\b'


def evidence(files, plan_lines=None):
    rx = re.compile(HEDGE_RX, re.IGNORECASE)
    stacked, single, n_sent = [], 0, 0
    for p in paragraphs(files):
        for i, (_, t) in enumerate(p['sentences']):
            n_sent += 1
            hs = [m.group(0).lower() for m in rx.finditer(t)]
            if len(hs) >= 2:
                stacked.append({**span(p, i), 'hedges': hs})
            elif hs:
                single += 1
    inventory = {
        'sentences_with_two_or_more_hedges': stacked[:40],
        'n_sentences_with_two_or_more_hedges': len(stacked),
        'n_sentences_with_one_hedge': single,
        'n_sentences': n_sent,
    }
    s = prose_search(files, HEDGE_RX, 'every hedged sentence', keep=25)
    return render_json('W-HEDGE', prose_files(files), inventory, [s])
