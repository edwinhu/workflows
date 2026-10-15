import importlib.util
import re
from pathlib import Path

from _common import render_json
from _elide import ELISION_RX, addenda, addendum_files, body_lines, clean, sentences, unescape

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
SPANS = ('bracketed_spans_of_four_or_more_words', 'body_sentences_with_editor_voice_terms')
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_body_lines_searched'

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


CONSTRAINTS = Path(__file__).resolve().parent.parent / 'constraints'
_QUOTES = []


def _quotes():
    """check-quotes, loaded once from the sibling constraints dir (None when it cannot load)."""
    if not _QUOTES:
        try:
            spec = importlib.util.spec_from_file_location('check_quotes', CONSTRAINTS / 'check-quotes.py')
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _QUOTES.append(mod)
        except Exception:  # noqa: BLE001 - no loader means no filtering, as for an unresolved source
            _QUOTES.append(None)
    return _QUOTES[0]


def bnorm(s):
    """check-quotes' norm, but [ ] survive as tokens so a bracket can be matched against the source."""
    s = s.replace('\u2019', "'").replace('\u2018', "'").replace('\u201c', '"').replace('\u201d', '"')
    for d in '\u2014\u2013\u2212':
        s = s.replace(d, '-')
    s = re.sub(r'[^a-z0-9\[\]]+', ' ', s.lower())
    return re.sub(r'\s*([\[\]])\s*', r'\1', re.sub(r'\s+', ' ', s)).strip()


BRACKET_CONTEXT = 40


def bracket_in_source(t, at, content, source):
    """True when the bracket plus up to BRACKET_CONTEXT characters of line text each side is verbatim in source.
    A context edge cut mid-word loses that partial word, so the cut itself cannot break the match."""
    end = at + len(content) + 2
    left, right = t[max(0, at - BRACKET_CONTEXT):at], t[end:end + BRACKET_CONTEXT]
    if at > BRACKET_CONTEXT and left[:1].isalnum() and t[at - BRACKET_CONTEXT - 1].isalnum():
        left = left.partition(' ')[2]
    if len(t) > end + BRACKET_CONTEXT and right[-1:].isalnum() and t[end + BRACKET_CONTEXT].isalnum():
        right = right.rpartition(' ')[0]
    return bnorm(clean(left) + ' ' + t[at:end] + ' ' + clean(right)) in source[1]


def source_texts(files):
    """{(label, reading title): (normalised text, bracket-preserving text)} for each reading whose source check-quotes resolves.
    A reading whose source is missing, ambiguous or unreadable is absent, so it is not filtered."""
    q = _quotes()
    out = {}
    if q is None:
        return out
    for rel, a in addendum_files(files):
        try:
            typ = Path(a)
            titles = [r['title'] for r in addenda([(rel, a)])[0][1]['readings']]
            rows = [r.split('\x1f') for r in q.resolve(typ, q.docs_dir_for(typ, []), []) if r and not r.startswith('!')]
            if len(rows) != len(titles):
                continue
            cache = {}
            for title, row in zip(titles, rows):
                if row[2] != 'OK' or (rel, title) in out:
                    continue
                if row[1] not in cache:
                    raw = q.strip_furniture(q.load_source(Path(row[1]))[0])
                    cache[row[1]] = (q.norm(raw), bnorm(raw))
                out[(rel, title)] = cache[row[1]]
        except Exception:  # noqa: BLE001
            continue
    return out


def evidence(files, plan_lines=None, changed=None):
    minimal, longer, voice = [], [], []
    verbatim = verbatim_brackets = 0
    sources = source_texts(files)
    for rel, title, n, text, section in body_lines(files, changed):
        t = unescape(text)
        for content, at in brackets(t):
            src = sources.get((rel, title))
            if src is not None and bracket_in_source(t, at, content, src):
                verbatim_brackets += 1   # the source's own alteration, not an editor's insertion
                continue
            words = len(content.split())
            c = {'file': rel, 'line': n, 'reading': title, 'bracketed': content[:400], 'words': words,
                 'context': clean(t[max(0, at - 160):at + len(content) + 160])}
            (longer if words >= 4 else minimal).append(c)
        for s in sentences(text):
            cs = COURT_PAREN_RX.sub('', clean(s))
            if VOICE_RX.search(cs):
                src = sources.get((rel, title))
                if src is not None and _quotes().norm(clean(s)) in src[0]:
                    verbatim += 1   # the court's own sentence, so it cannot be the editors' voice
                    continue
                voice.append({'file': rel, 'line': n, 'reading': title, 'section': section, 'sentence': clean(s)[:400]})
    inventory = {
        'n_body_lines_searched': len(body_lines(files)),
        'bracketed_spans_of_four_or_more_words': longer[:25],
        'n_bracketed_spans_of_four_or_more_words': len(longer),
        'short_bracketed_spans': [{'line': c['line'], 'bracketed': c['bracketed']} for c in minimal[:25]],
        'n_short_bracketed_spans': len(minimal),
        'body_sentences_with_editor_voice_terms': voice[:25],
        'n_body_sentences_with_editor_voice_terms': len(voice),
        'n_voice_term_sentences_verbatim_in_source': verbatim,
        'n_bracketed_spans_verbatim_in_source': verbatim_brackets,
        'voice_terms_searched': VOICE_RX.pattern,
    }
    return render_json('EL-VOICE', addendum_files(files), inventory, [])
