import re

from _common import render_json
from _econ import EXHIBIT_RX, MAX_ITEMS, prose_files, scope_note, sentences, span

DELIVERABLE = 'finance or accounting journal'

PROPOSITION = ('An estimate is reported without its size or without its precision: a sentence about the '
               'paper\'s own estimate says it is significant, positive, negative, large or small but gives '
               'no magnitude in economic units (percent, basis points, dollars, a one-standard-deviation '
               'change, a share of the mean) in that sentence or the next; or it gives a point estimate '
               'with no standard error, t-statistic, confidence interval or significance level and points '
               'to no table that carries them.')

CRITERIA = {
    'VIOLATED': 'at least one sentence reports the paper\'s own estimate by sign or significance alone, or '
                'gives a bare point estimate with no uncertainty and no table to find it in',
    'SATISFIED': 'every reported estimate carries an economic magnitude, and its uncertainty is given in '
                 'the text or in a table the sentence names',
    'NOT_APPLICABLE': 'the state holds no sentence reporting an estimate',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('estimate_sentences',)

# statistical significance, not the plain-English "significant impact"
ESTIMATE_RX = (r'\bstatistically (?:in)?significan(?:t|tly|ce)\b|\b(?:in)?significant at\b|\bsignificance level|'
               r'\b(?:positive|negative)(?: and| but)? (?:statistically |highly |marginally |strongly )?'
               r'(?:in)?significant\b|\b(?:highly|marginally|strongly) significant\b|\bcoefficients?\b|\bpoint estimates?\b|'
               r'\belasticit(?:y|ies)\b|\bsemi-elasticit|\bmarginal effects?\b|\bt-stat(?:istic)?s?\b|'
               r'\b(?:positive(?:ly)?|negative(?:ly)?) (?:and )?(?:related|associated|correlated|relation|'
               r'association|effect|coefficient|loading)\b|\bloads? (?:positively|negatively)\b')
UNIT_RX = re.compile(r'\d[\d,.]*\s*(?:%|percent|percentage points?|pp\b|basis points?|bps?\b|bp\b|cents?|'
                     r'dollars?|million|billion|times)|\$\s?\d|\bone[- ]standard[- ]deviation\b|'
                     r'\b(?:\d[\d.]*|one|two|half)\s+standard deviations?\b|\bof the (?:sample )?mean\b',
                     re.IGNORECASE)
PRECISION_RX = re.compile(r'\bstandard errors?\b|\bs\.e\.|\bt-stat|\bt\s?=|\bp\s?[<=]|\bp-values?\b|'
                          r'\bconfidence intervals?\b|\b(?:1|5|10)(?:%| percent) level\b|\bCI\b', re.IGNORECASE)


def evidence(files, plan_lines=None, changed=None):
    rx = re.compile(ESTIMATE_RX, re.IGNORECASE)
    cands, n_all = [], 0
    for s in sentences(files, changed):
        if not rx.search(s['sentence']):
            continue
        n_all += 1
        if not s['in_scope']:
            continue
        reach = ' '.join(x for x in (s['sentence'], s['after']) if x)
        cands.append({**span(s),
                      'economic_unit_in_sentence_or_next': bool(UNIT_RX.search(reach)),
                      'precision_in_sentence_or_next': bool(PRECISION_RX.search(reach)),
                      'exhibit_reference_in_reach': bool(EXHIBIT_RX.search(' '.join(
                          x for x in (s['before'], s['sentence'], s['after']) if x)))})
    inventory = {
        'estimate_sentences': cands[:MAX_ITEMS],
        'n_estimate_sentences_listed': len(cands),
        'n_estimate_sentences_in_files': n_all,
        'n_listed_with_neither_unit_nor_exhibit': sum(1 for c in cands if not c['economic_unit_in_sentence_or_next']
                                                       and not c['exhibit_reference_in_reach']),
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('E-MAGNITUDE', prose_files(files), inventory, [])
