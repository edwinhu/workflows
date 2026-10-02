from _common import _search, render_json
from _elide import ELISION_RX, addendum_files, body_lines, clean, plan_target, sentences

DELIVERABLE = 'casebook-excerpt'
SUBJECT = 'one casebook excerpt (a court opinion cut into a student reading)'

PROPOSITION = ('An editorial elision mark cuts INSIDE a sentence that states the court\'s holding, its rule, '
               'or an operative step of its reasoning on the doctrinal thread, so the retained sentence no longer '
               'carries that statement whole: its condition, qualifier, exception or conclusion is gone or spliced '
               'across the mark. A mark between whole sentences, or inside facts, procedural history, testimony or a '
               'citation, is not a violation.')

CRITERIA = {
    'VIOLATED': 'at least one elision mark sits inside a sentence that states the holding, the rule or an '
                'operative reasoning step, and the text on either side of the mark no longer states it whole',
    'SATISFIED': 'every elision mark falls between whole sentences, or inside facts, history, testimony or '
                 'citations, leaving every holding and rule sentence intact',
    'NOT_APPLICABLE': 'the excerpt carries no editorial elision mark',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}


def _position(sent):
    """A mark opening a sentence, or standing alone, falls between sentences; anywhere else it cuts one."""
    m = ELISION_RX.search(sent)
    before = sent[:m.start()].strip()
    return 'between sentences' if not before else 'inside a sentence'


def evidence(files, plan_lines=None, changed=None):
    inside, between = [], []
    for rel, title, n, text, section in body_lines(files, changed):
        if not ELISION_RX.search(text):
            continue
        ss = sentences(text)
        for j, s in enumerate(ss):
            if not ELISION_RX.search(s):
                continue
            c = {'file': rel, 'line': n, 'reading': title, 'section': section,
                 'sentence': clean(s)[:500],
                 'before': clean(ss[j - 1])[:300] if j > 0 else None,
                 'after': clean(ss[j + 1])[:300] if j + 1 < len(ss) else None}
            (inside if _position(s) == 'inside a sentence' else between).append(c)
    inventory = {
        'doctrinal_target': plan_target(plan_lines) or 'no plan supplied',
        'marks_inside_a_sentence': inside[:30],
        'n_marks_inside_a_sentence': len(inside),
        'marks_between_sentences': between[:12],
        'n_marks_between_sentences': len(between),
    }
    af = addendum_files(files)
    s = _search(af, ELISION_RX.pattern, 'every bracketed elision mark', keep=5)
    return render_json('EL-HOLDING', af, inventory, [s])
