import re

from _common import render_json
from _elide import addenda, addendum_files, in_changed, notes

DELIVERABLE = 'casebook-excerpt'
SUBJECT = 'one casebook excerpt (a court opinion cut into a student reading)'

PROPOSITION = ('A reading\'s editors\' note is boilerplate: it carries no background the student needs to read the '
               'case (prior history of the same litigation, an earlier related decision the court reacts to, '
               'real-world context) and no disclosure specific to its own reading (a named retained or dropped '
               'footnote, qualifier, alternative holding, dissent or separate opinion) -- it only restates '
               'document-wide mechanical conventions such as the elision mark, that footnotes are omitted or '
               'renumbered, or that record citations are dropped. Those conventions belong once in the addendum\'s '
               'preamble, so a note that carries nothing else is boilerplate whether or not a preamble is shown.')

CRITERIA = {
    'VIOLATED': 'at least one reading\'s note says nothing beyond document-wide mechanical conventions',
    'SATISFIED': 'every reading\'s note carries background or a disclosure specific to that reading, or no '
                 'reading has a note',
    'NOT_APPLICABLE': 'no reading carries an editors\' note',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

CONVENTION_RX = re.compile(r'ellips|elision|omissions? (are|is|have been) (marked|indicated)|footnotes?[^.]{0,60}'
                           r'(omitted|renumbered)|record citations?|bracket', re.IGNORECASE)


def evidence(files, plan_lines=None, changed=None):
    reading_notes, preamble_notes = [], []
    for rel, title, n, text in notes(files):
        if not in_changed(changed, rel, n, n + 3):
            continue
        rec = {'file': rel, 'line': n, 'reading': title, 'note': text,
               'mechanical_convention_phrases': [m.group(0) for m in CONVENTION_RX.finditer(text)][:8]}
        (reading_notes if title else preamble_notes).append(rec)
    titled = {(rel, r['title']) for rel, p in addenda(files) for r in p['readings']}
    with_note = {(x['file'], x['reading']) for x in reading_notes}
    inventory = {
        'reading_notes': reading_notes[:12],
        'n_reading_notes': len(reading_notes),
        'n_readings': len(titled),
        'readings_without_a_note': sorted(t for _, t in titled - with_note)[:20],
        'preamble_notes': preamble_notes[:3],
    }
    return render_json('EL-NOTE', addendum_files(files), inventory, [])
