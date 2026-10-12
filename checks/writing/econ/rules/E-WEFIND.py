import re

from _common import render_json
from _econ import EXHIBIT_RX, MAX_ITEMS, prose_files, scope_note, sentences, span

DELIVERABLE = 'finance or accounting journal'

PROPOSITION = ('A finding is stated with no pointer to its evidence: a "we find / we show / we document / '
               'our results show" sentence in the body of the paper reports an empirical result, and '
               'neither it, the sentences beside it nor its paragraph names the table, figure, column or '
               'appendix exhibit that carries the result. The abstract, the introduction and the '
               'conclusion preview or recap results the body reports with references, and are exempt; so '
               'is a finding attributed to another paper, and a statement of what the paper will do.')

CRITERIA = {
    'VIOLATED': 'at least one body-section finding sentence has no table, figure, column or exhibit '
                'reference in its own sentence, its neighbours or its paragraph',
    'SATISFIED': 'every body-section finding sentence is anchored to an exhibit, or every unanchored one '
                 'sits in the abstract, introduction or conclusion, reports another paper, or announces',
    'NOT_APPLICABLE': 'the state holds no finding sentence',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('finding_sentences',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_sentences_searched'

FIND_RX = (r'\bwe (?:also |further |then |still )?(?:find|show|document|observe|estimate|confirm|'
           r'detect|uncover)\b|\bour (?:results|estimates|findings|evidence|analysis|tests?) '
           r'(?:show|suggest|indicate|reveal|confirm|imply|demonstrate)\b|\bthe (?:results|estimates|'
           r'evidence) (?:show|suggest|indicate|reveal|confirm)\b')
FRAME_RX = re.compile(r'\b(abstract|introduction|conclusions?|concluding|summary|front matter)\b', re.IGNORECASE)


def evidence(files, plan_lines=None, changed=None):
    rx = re.compile(FIND_RX, re.IGNORECASE)
    found, n_all = [], 0
    ss = sentences(files, changed)
    for s in ss:
        if not rx.search(s['sentence']):
            continue
        n_all += 1
        if not s['in_scope']:
            continue
        reach = ' '.join(x for x in (s['before'], s['sentence'], s['after']) if x)
        found.append({**span(s),
                      'section_is_abstract_intro_or_conclusion': bool(s['heading'] and FRAME_RX.search(s['heading'])),
                      'exhibit_reference_in_reach': bool(EXHIBIT_RX.search(reach)),
                      'exhibits_named_in_paragraph': s['paragraph_exhibits']})
    unanchored = [f for f in found if not f['exhibit_reference_in_reach'] and not f['exhibits_named_in_paragraph']]
    inventory = {
        'n_sentences_searched': len(ss),
        'finding_sentences': found[:MAX_ITEMS],
        'n_finding_sentences_listed': len(found),
        'n_finding_sentences_in_files': n_all,
        'n_listed_with_no_exhibit_in_sentence_neighbours_or_paragraph': len(unanchored),
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('E-WEFIND', prose_files(files), inventory, [])
