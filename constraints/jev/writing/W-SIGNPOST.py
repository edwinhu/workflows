import re

from _common import render_json
from _prose import paragraphs, prose_files, prose_search, span

DELIVERABLE = 'prose'

PROPOSITION = ('The prose ANNOUNCES instead of SAYING: at least one sentence only describes what the '
               'document, section or paragraph will do, is doing or has done ("This section discusses '
               'X", "We now turn to Y", "As discussed above", "In summary, ...", "The following '
               'explains ...") or restates a heading, where it should state the point itself. A '
               'sentence that carries its own claim ("This letter asks the Commission to withdraw '
               'Rule 14a-8(i)(7)") is not a signpost.')

CRITERIA = {
    'VIOLATED': 'at least one candidate sentence does no work but announce, preview or recap -- '
                'deleting it would lose no claim, fact or ask',
    'SATISFIED': 'every candidate sentence carries its own claim, fact or ask; none is pure '
                 'announcement or recap',
    'NOT_APPLICABLE': 'the state holds no prose sentences',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('signpost_candidates',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_sentences_searched'

SIGNPOST_RX = (r'\b(this|the following|the next|the present|in this|in the next|the previous|'
               r'the preceding) (section|part|paper|memo|letter|article|essay|chapter|report|'
               r'paragraph|discussion|analysis)\b|\bwe (now )?(turn|proceed|begin|conclude|discuss|'
               r'examine|describe|outline|review|explore|consider)\b|\b(as (discussed|noted|mentioned|'
               r'explained|described|shown) (above|below|earlier|previously)|in (summary|sum|'
               r'conclusion|short)|to (summarize|sum up|conclude)|the following|below,? we|'
               r'it is (worth|important to) (noting|note))\b')


def evidence(files, plan_lines=None):
    rx = re.compile(SIGNPOST_RX, re.IGNORECASE)
    cands, openers = [], []
    for p in paragraphs(files):
        if p['kind'] != 'para':
            continue
        for i, (_, t) in enumerate(p['sentences']):
            if rx.search(t):
                cands.append(span(p, i))
        if p['sentences']:
            openers.append(span(p, 0))
    inventory = {
        'signpost_candidates': cands[:40],
        'n_signpost_candidates': len(cands),
        'paragraph_openers': openers[:25],
        'n_paragraphs': len(openers),
    }
    s = prose_search(files, SIGNPOST_RX, 'sentences that name the document or a section, or recap')
    inventory['n_sentences_searched'] = s['lines_searched']
    return render_json('W-SIGNPOST', prose_files(files), inventory, [s])
