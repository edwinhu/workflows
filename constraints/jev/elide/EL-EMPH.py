import re

from _common import render_json
from _elide import addendum_files, body_lines, unescape

DELIVERABLE = 'casebook-excerpt'
SUBJECT = 'one casebook excerpt (a court opinion cut into a student reading)'

PROPOSITION = ('A quoted passage is altered without notation: a quotation inside the court\'s text carries emphasis '
               '(italics or bold) on ordinary words -- not a case name, a statute or book title, or a foreign or '
               'Latin term the court sets in italics -- and no notation after the quotation says whose emphasis it '
               'is ("emphasis added", "emphasis in original", "emphasis omitted" or similar).')

CRITERIA = {
    'VIOLATED': 'at least one quotation stresses ordinary words and carries no emphasis notation',
    'SATISFIED': 'every emphasized word inside a quotation is a case name, title or foreign term, or the quotation '
                 'carries an emphasis notation',
    'NOT_APPLICABLE': 'no quotation in the state carries emphasis',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('quotations_stressing_ordinary_words',)

QUOTE_RX = re.compile(r'[“"]([^“”"]{3,900})[”"]')
EMPH_RX = re.compile(r'(?<![\w\\])_([^_]{1,200}?)_(?!\w)|#emph\[([^\]]{1,200})\]|(?<![\w\\])\*([^*]{1,200})\*(?!\w)')
# italics a court sets by convention, not for stress: Latin and citation signals, and case names
CONVENTIONAL_RX = re.compile(r'^\W*(i\.\s?e\.|e\.\s?g\.|id\.|ibid\.|supra|infra|quid pro quo|per se|sic|et al\.|'
                             r'inter alia|de minimis|de novo|bona fide|sua sponte|certiorari|a fortiori|mens rea|'
                             r'prima facie|res judicata|amicus curiae|pro rata|ultra vires|see|see also|cf\.|accord)\W*$',
                             re.IGNORECASE)
CASE_NAME_RX = re.compile(r'\bv\.\s|^\W*[A-Z][\w.\'’&-]*(\s+[A-Z][\w.\'’&-]*){0,3}\W*$')
NOTATION_RX = re.compile(r'emphasis (added|in original|omitted|supplied|deleted)|alteration|cleaned up', re.IGNORECASE)


def conventional(span):
    return bool(CONVENTIONAL_RX.match(span) or CASE_NAME_RX.search(span))


def evidence(files, plan_lines=None, changed=None):
    stressed, n_quotes, n_conventional = [], 0, 0
    for rel, title, n, text, section in body_lines(files, changed):
        t = unescape(text)
        for m in QUOTE_RX.finditer(t):
            n_quotes += 1
            em = [next(g for g in e.groups() if g) for e in EMPH_RX.finditer(m.group(1))]
            stress = [x for x in em if not conventional(x)]
            n_conventional += len(em) - len(stress)
            if not stress:
                continue
            after = t[m.end():m.end() + 220]
            stressed.append({'file': rel, 'line': n, 'reading': title,
                             'quotation_with_emphasis_marked_by_underscores': m.group(1)[:600],
                             'emphasized_words': stress[:8],
                             'text_after_the_quotation': after,
                             'notation_regex_hit_after': bool(NOTATION_RX.search(after))})
    inventory = {
        'quotations_stressing_ordinary_words': stressed[:30],
        'n_quotations_stressing_ordinary_words': len(stressed),
        'n_conventional_italics_in_quotations_set_aside': n_conventional,
        'conventional_italics_rule': 'case names and Latin or citation terms (i.e., id., quid pro quo, ...) '
                                     'are the court\'s typography, not stress, and are not listed',
        'n_quotations': n_quotes,
    }
    return render_json('EL-EMPH', addendum_files(files), inventory, [])
