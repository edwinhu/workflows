from _common import render_json
from _scholar import SENT_RX, citing, clauses, clip, load, prose_files, scope_note, touches

DELIVERABLE = 'law review'

PROPOSITION = ('A footnote carries a step of the argument the text needs: the body relies on a claim, '
               'reason, definition or answer to an objection that is stated only in a footnote, so a '
               'reader of the text alone cannot follow the argument. Footnotes that cite, quote, '
               'qualify, add an example, collect authority, explain a method or data choice, or note a '
               'caveat the body does not build on are where law review prose puts those, and are '
               'compliant.')

CRITERIA = {
    'VIOLATED': 'at least one footnote states a premise, reason or definition that the body text after '
                'its marker depends on and never states itself',
    'SATISFIED': 'every discursive footnote supports, qualifies or extends a point the body already '
                 'makes; the body argument reads complete without them',
    'NOT_APPLICABLE': 'the state holds no footnote with discursive text',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

MIN_WORDS = 30


def _prose_words(text):
    """Words in the footnote's non-citing clauses: the discursive part a reader reads as argument."""
    pieces = [c for part in SENT_RX.split(text) for c in clauses(part)]
    return sum(len(c.split()) for c in pieces if not citing(c))


def evidence(files, plan_lines=None, changed=None):
    cands, n_notes = [], 0
    for doc in load(files):
        flat = [(i, j, s) for i, p in enumerate(doc['paras']) for j, s in enumerate(p['sentences'])]
        for note in doc['notes']:
            n_notes += 1
            words = _prose_words(note['text'])
            if words < MIN_WORDS:
                continue
            mark = f'[^{note["n"]}]'
            at = next((k for k, (_, _, s) in enumerate(flat) if mark in s[2]), None)
            if at is None:
                continue
            line = flat[at][2][0]
            if not touches(changed, doc['file'], min(line, note['line']), max(flat[at][2][1], note['end_line'])):
                continue
            pi = flat[at][0]
            para = ' '.join(t for _, _, t in doc['paras'][pi]['sentences'])
            nxt = [flat[k][2][2] for k in range(at + 1, min(at + 3, len(flat))) if flat[k][0] != pi]
            cands.append({
                'file': doc['file'], 'line': note['line'], 'footnote': note['n'],
                'discursive_words': words, 'footnote_text': clip(note['text'], 700),
                'body_sentence_with_marker': clip(flat[at][2][2], 350),
                'body_paragraph_with_marker': clip(para, 1200),
                'next_paragraph_opening': [clip(t, 300) for t in nxt][:1],
            })
    cands.sort(key=lambda c: -c['discursive_words'])
    inventory = {
        'discursive_footnotes': cands[:30],
        'n_discursive_footnotes': len(cands),
        'n_footnotes': n_notes,
        'selection': (f'footnotes with at least {MIN_WORDS} words outside their citation clauses, longest '
                      'first, each with the body sentence and whole paragraph that carry its marker and the next '
                      'paragraph\'s first sentence'),
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('L-FNARG', prose_files(files), inventory, [])
