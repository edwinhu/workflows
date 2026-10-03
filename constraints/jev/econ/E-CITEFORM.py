import re

from _common import render_json
from _econ import MAX_ITEMS, clip, load, prose_files, scope_note, sentences, span, touches

DELIVERABLE = 'finance or accounting journal'

PROPOSITION = ('A citation is not in the journal\'s inline author-date form: a source is cited in law '
               'review form (a full citation with volume, reporter or journal and first page, or a '
               'Bluebook short form) or by a bare number ("[12]"), or a parenthetical citation stands in '
               'as a sentence\'s subject or object ("(Smith, 2010) shows", "as in (Smith, 2010)") where '
               'the narrative form "Smith (2010)" belongs. Author-date citations in footnotes, and '
               'citations of statutes, rules or regulations by number, are compliant.')

CRITERIA = {
    'VIOLATED': 'at least one candidate cites a paper in law review or numbered form, or uses a '
                'parenthetical citation as a noun phrase',
    'SATISFIED': 'every paper is cited author-date, narrative ("Smith (2010) shows") or parenthetical '
                 '("... (Smith, 2010)"), in the text or a footnote',
    'NOT_APPLICABLE': 'the state holds no citation',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('text_citation_candidates', 'footnote_citation_candidates')

AUTHOR = r"[A-Z][A-Za-z'’-]+(?:,? (?:and|&) [A-Z][A-Za-z'’-]+| et al\.)?"
YEAR = r'(?:19|20)\d\d[a-z]?'
NARRATIVE_RX = re.compile(rf'\b{AUTHOR} \({YEAR}(?:, [^)]*)?\)')
PAREN_RX = re.compile(rf'\((?:[^()]*?; )?{AUTHOR},? {YEAR}(?:[;,][^()]*)?\)')
# a parenthetical cite right after a preposition, or right before a verb: used as a noun phrase
NOUN_USE_RX = re.compile(rf'\b(?:in|by|of|from|see|follow(?:ing)?|unlike|like|to)\s+{PAREN_RX.pattern}|'
                         rf'{PAREN_RX.pattern}\s+(?:show|shows|find|finds|document|documents|argue|argues|'
                         rf'report|reports|demonstrate|demonstrates|suggest|suggests|propose|proposes)\b')
LAWREV_RX = re.compile(r'\b\d+\s+(?:[A-Z][A-Za-z.\'&]*\s){1,6}\d+(?:,\s*\d+)?\s*\((?:[^()]*\s)?(?:19|20)\d\d\)|'
                       r'\bsupra\b|(?<![\w.])[Ii]d\.(?=[\s,]|$)|\bhereinafter\b')
NUMBERED_RX = re.compile(r'(?<![\w\]])\[\d+(?:[,–-]\s*\d+)*\](?!\()')


def evidence(files, plan_lines=None, changed=None):
    cands, n_narr, n_paren = [], 0, 0
    for s in sentences(files, changed):
        t = s['sentence']
        n_narr += len(NARRATIVE_RX.findall(t))
        n_paren += len(PAREN_RX.findall(t))
        kinds = [k for k, rx in (('law_review_form', LAWREV_RX), ('numbered', NUMBERED_RX),
                                 ('parenthetical_as_noun', NOUN_USE_RX)) if rx.search(t)]
        if kinds and s['in_scope']:
            cands.append({**span(s), 'kinds': kinds})
    notes = []
    for doc in load(files):
        for note in doc['notes']:
            kinds = [k for k, rx in (('law_review_form', LAWREV_RX), ('numbered', NUMBERED_RX)) if rx.search(note['text'])]
            if kinds and touches(changed, doc['file'], note['line'], note['end_line']):
                notes.append({'file': doc['file'], 'line': note['line'], 'footnote': note['n'],
                              'text': clip(note['text'], 400), 'kinds': kinds})
    inventory = {
        'text_citation_candidates': cands[:MAX_ITEMS],
        'n_text_citation_candidates': len(cands),
        'footnote_citation_candidates': notes[:20],
        'n_footnote_citation_candidates': len(notes),
        'n_narrative_author_date_citations': n_narr,
        'n_parenthetical_author_date_citations': n_paren,
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('E-CITEFORM', prose_files(files), inventory, [])
