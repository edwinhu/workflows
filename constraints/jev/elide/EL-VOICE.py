import re

from _common import render_json
from _elide import ELISION_RX, addendum_files, body_lines, clean, sentences, unescape

DELIVERABLE = 'casebook-excerpt'
SUBJECT = 'one casebook excerpt (a court opinion cut into a student reading)'

PROPOSITION = ('Editorial text is presented as the court\'s: inside the opinion body, outside any editors\' note, '
               'a sentence or clause speaks in the editors\' voice -- it addresses the student, describes the excerpt '
               'or what was cut, or summarizes or comments on the case -- without brackets; or a bracketed span '
               'carries such commentary or summary instead of a minimal insertion or alteration that slots into '
               'the court\'s own sentence ([T]he, [the issuer], [That representation], [, for example,]).')

CRITERIA = {
    'VIOLATED': 'at least one listed span is editorial commentary, summary or direction to the reader set as the '
                'court\'s text, unbracketed, or bracketed but doing more than a minimal substitution',
    'SATISFIED': 'every bracketed span is a minimal insertion or alteration and no body sentence speaks in the '
                 'editors\' voice',
    'NOT_APPLICABLE': 'the state holds no opinion body text',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

# a bracket that is Typst markup, not an editorial bracket: #emph[...], #text(..)[...], #super[...]
MARKUP_OPEN_RX = re.compile(r'#[a-zA-Z.]+(\([^)]*\))?$')
VOICE_RX = re.compile(
    r'\b(this|the|our) (excerpt|reading|addendum|casebook|edited (version|opinion))\b|\beditors?\b|\bstudents?\b'
    r'|\bthe reader\b|\b(we|have been|has been|were|was) (omitted|cut|excerpted|edited|condensed|removed)\b'
    r'|\bfor (class|our purposes)\b|\bnote (that|how|the)\b|\(ed\.\)|\bN\.B\.|\bkeep in mind\b|\bnotice (that|how)\b',
    re.IGNORECASE)
COURT_PAREN_RX = re.compile(r'\([^()]*\b(omitted|added|in original|altered|cleaned up)\)', re.IGNORECASE)


def brackets(text):
    """(content, start) for each editorial [ ] span of one line; Typst calls and elision marks are skipped."""
    out, depth, start = [], 0, None
    stack = []
    for i, ch in enumerate(text):
        if ch == '[':
            stack.append((i, bool(MARKUP_OPEN_RX.search(text[:i]))))
        elif ch == ']' and stack:
            j, markup = stack.pop()
            span = text[j:i + 1]
            if not markup and not ELISION_RX.fullmatch(span):
                out.append((text[j + 1:i], j))
    return out


def evidence(files, plan_lines=None, changed=None):
    minimal, longer, voice = [], [], []
    for rel, title, n, text, section in body_lines(files, changed):
        t = unescape(text)
        for content, at in brackets(t):
            words = len(content.split())
            c = {'file': rel, 'line': n, 'reading': title, 'bracketed': content[:400], 'words': words,
                 'context': clean(t[max(0, at - 160):at + len(content) + 160])}
            (longer if words >= 4 else minimal).append(c)
        for s in sentences(text):
            cs = COURT_PAREN_RX.sub('', clean(s))
            if VOICE_RX.search(cs):
                voice.append({'file': rel, 'line': n, 'reading': title, 'section': section, 'sentence': clean(s)[:400]})
    inventory = {
        'bracketed_spans_of_four_or_more_words': longer[:25],
        'n_bracketed_spans_of_four_or_more_words': len(longer),
        'short_bracketed_spans': [{'line': c['line'], 'bracketed': c['bracketed']} for c in minimal[:25]],
        'n_short_bracketed_spans': len(minimal),
        'body_sentences_with_editor_voice_terms': voice[:25],
        'n_body_sentences_with_editor_voice_terms': len(voice),
        'voice_terms_searched': VOICE_RX.pattern,
    }
    return render_json('EL-VOICE', addendum_files(files), inventory, [])
