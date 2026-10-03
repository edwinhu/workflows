import re

from _common import render_json
from _prose import paragraphs, prose_files, prose_search, span

DELIVERABLE = 'prose'

PROPOSITION = ('A claim of fact rests on an unnamed authority or an unsourced number: vague '
               'attribution ("studies show", "experts agree", "many observers", "it is widely '
               'believed", "research suggests", "critics argue") with no named source, or a statistic '
               'with no citation, footnote, table/figure reference, date or named source in its own '
               'sentence or the next.')

CRITERIA = {
    'VIOLATED': 'at least one candidate asserts a fact or number on an unnamed authority, with no '
                'source in reach',
    'SATISFIED': 'every candidate names its source, cites, points to a table, figure or exhibit, or '
                 'is the author\'s own stated measurement or arithmetic',
    'NOT_APPLICABLE': 'the state holds no vague attribution and no factual statistic',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('vague_attributions', 'statistics_without_a_source_marker')

WEASEL_RX = (r'\b(studies|research|evidence|experts?|scholars|commentators|observers|critics|'
             r'analysts|many|some|most) (have )?(show|shows|shown|suggest|suggests|find|finds|found|'
             r'agree|agrees|argue|argues|believe|believes|say|says|note|notes|indicate|indicates)\b|'
             r'\bit is (widely|generally|commonly|often) (believed|accepted|known|thought|said|'
             r'recognized)\b|\b(widely|generally) (regarded|considered|seen)\b|'
             r'\b(many|some) (have|would) (argued|suggested|said)\b')
NUM_RX = r'\b\d[\d,.]*\s*(%|percent|per cent|basis points|bps|billion|million|trillion|times)|\$\s?\d'
SOURCE_RX = (r'\[\^?[\w-]+\]|\[@|\^\[|\(\w[^()]{0,60}\b(19|20)\d\d[a-z]?\)|\bet al\b|\bTable \d|'
             r'\bFigure \d|\bExhibit\b|\bsee\b|\bid\.|\bsupra\b|\bhttps?://|\bat \d+\b|'
             r'\b(according to|reports?|reported|data from|source:)\b|\\cite|@\w+|#cite|'
             r'\b(19|20)\d\d\b')


def evidence(files, plan_lines=None):
    w = re.compile(WEASEL_RX, re.IGNORECASE)
    num = re.compile(NUM_RX, re.IGNORECASE)
    src = re.compile(SOURCE_RX)
    vague, numbers = [], []
    for p in paragraphs(files):
        ss = p['sentences']
        for i, (_, t) in enumerate(ss):
            reach = t + ' ' + (ss[i + 1][1] if i + 1 < len(ss) else '')
            if w.search(t):
                vague.append({**span(p, i), 'source_marker_in_reach': bool(src.search(reach))})
            if num.search(t):
                numbers.append({**span(p, i), 'source_marker_in_reach': bool(src.search(reach))})
    unsourced = [c for c in numbers if not c['source_marker_in_reach']]
    inventory = {
        'vague_attributions': vague[:30],
        'n_vague_attributions': len(vague),
        'statistics_without_a_source_marker': unsourced[:30],
        'n_statistics': len(numbers),
        'n_statistics_without_a_source_marker': len(unsourced),
    }
    s = prose_search(files, WEASEL_RX, 'every vague attribution ("studies show", "experts agree")')
    return render_json('W-ATTRIB', prose_files(files), inventory, [s])
