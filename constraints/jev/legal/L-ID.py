import re

from _common import render_json
from _scholar import MAX_ITEMS, citing, clip, load, pieces, prose_files, scope_note, touches

DELIVERABLE = 'law review'

PROPOSITION = ('An "Id." short form has no single antecedent authority. Its antecedent is the citation '
               'clause just before it in its own footnote, or, when it opens its footnote, the whole '
               'immediately preceding footnote. It is VIOLATED only when that antecedent cites two or more '
               'DIFFERENT sources, or cites none (the preceding footnote is pure text or an internal '
               'cross-reference). The same source cited twice is one source; a source named only inside an '
               'explanatory parenthetical ("quoting ...", "citing ...", "reporting ...") or in prior or '
               'subsequent history does not count; an Id. in a parenthetical or in "see also id." still '
               'needs one antecedent.')

CRITERIA = {
    'VIOLATED': 'at least one Id. has an antecedent that cites two or more different sources, or none -- '
                'name the Id. and the competing sources',
    'SATISFIED': 'every Id. has exactly one source as its antecedent',
    'NOT_APPLICABLE': 'the state holds no Id. short form',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('id_short_forms',)

ID_RX = re.compile(r'(?<![\w.])[Ii]d\.')


def evidence(files, plan_lines=None, changed=None):
    sites, n_all, n_notes = [], 0, 0
    for doc in load(files):
        notes = doc['notes']
        n_notes += len(notes)
        for k, note in enumerate(notes):
            for m in ID_RX.finditer(note['text']):
                n_all += 1
                if not touches(changed, doc['file'], note['line'], note['end_line']):
                    continue
                before = [c for c in pieces(note['text'][:m.start()]) if citing(c)]
                if before:
                    where, ante = 'the clause before it in the same footnote', before[-1:]
                elif k:
                    where, ante = f'the whole preceding footnote {notes[k - 1]["n"]}', [
                        c for c in pieces(notes[k - 1]['text']) if citing(c)]
                else:
                    where, ante = 'none: it is in the first footnote', []
                sites.append({'file': doc['file'], 'line': note['line'], 'footnote': note['n'],
                              'id_in_context': clip(note['text'][max(0, m.start() - 120):m.start() + 160], 300),
                              'antecedent_is': where,
                              'antecedent_citation_clauses': [clip(c, 220) for c in ante][:8],
                              'n_antecedent_citation_clauses': len(ante)})
    inventory = {
        'id_short_forms': sites[:MAX_ITEMS],
        'n_id_short_forms_listed': len(sites),
        'n_id_short_forms_in_files': n_all,
        'n_footnotes': n_notes,
        'note_on_clauses': ('a citation clause is a sentence or semicolon clause of the footnote that carries '
                            'a cite marker outside its parentheticals; two clauses can cite the same source '
                            '(a full cite and a short form of it), so the count is a hint, the text decides'),
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('L-ID', prose_files(files), inventory, [])
