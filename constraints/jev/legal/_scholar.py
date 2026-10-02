"""Shared extraction for the legal and econ register rules: footnotes, body sentences, headings.

A scholarly draft is read as two streams. Footnotes (Typst `#footnote[...]`, LaTeX `\\footnote{...}`,
Markdown `[^id]` / `^[...]`) are pulled out in order and numbered per file; the body keeps a `[^n]`
marker where each sat, at the same offsets, so every body sentence keeps its file:line. Typst, TeX
and Markdown emphasis is unwrapped, so a judge reads `Id. at 94`, not `#emph[Id.] at 94`.

constraints/jev/econ imports this module too (it puts this directory on sys.path).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'writing'))  # _prose

from _common import _read
from _prose import ABBREV, blocks, prose_files

MAX_ITEMS = 40
CLIP = 500

# initials and citation abbreviations ("Eugene F. Fama", "33 J. Fin. Econ. 3") end no sentence
CITE_ABBREV = ''.join(rf'(?<!\b{a}\.)' for a in
                      ('[A-Z]', 'Fin', 'Econ', 'Rev', 'Stud', 'Acct', 'Res', 'Corp', 'Gov', 'Mgmt', 'Sci',
                       'Pol', 'Bus', 'Admin', 'Ass', 'Am', 'Univ', 'Int', 'Q', 'Ch', 'Cir', 'Supp', 'Reg',
                       'Stat', 'Cong', 'Comm', 'Sess', 'Rep', 'Doc', 'Exch', 'Sec', 'Gen', 'Op', 'Ct', 'Del',
                       'Mkts', 'Inst', 'Pa', 'Mass', 'Cal', 'Colum', 'Harv', 'Yale', 'Stan', 'Chi', 'Mich',
                       'Va', 'Tex', 'Geo', 'Nw', 'Wash', 'Cornell', 'Duke', 'Emory', 'Minn', 'Ill', 'Wis',
                       'Ind', 'Ann', 'Rel', 'Fed', 'Jan', 'Feb', 'Mar', 'Apr', 'Aug', 'Sept', 'Oct', 'Nov',
                       'Dec', 'eds', 'ed', 'Assoc', 'Dep\'t', 'Comm\'n', 'Ltd', 'Bros', 'Ry', 'Cnty', 'Indus'))
SENT_RX = re.compile(r'(?<=[.!?])' + ABBREV + CITE_ABBREV + r'["\u201d)]?\s+(?=["\u201c(]?[A-Z0-9])')
MARK_RX = re.compile(r'\[\^(\d+)\]')

# A clause of a footnote that cites something: a reporter or journal cite, a code section, a short
# form, a URL, a year in parentheses, or a pandoc/Typst cite key.
CITE_RX = re.compile(
    r'\b\d+\s+(?:[A-Z][A-Za-z.\'&]*\s?){1,6}\d+\b|\bU\.S\.C\.|\bC\.F\.R\.|§|\bsupra\b|\binfra\b|'
    r'(?<![\w.])[Ii]d\.|\bhttps?://|\((?:[^()]*\s)?(?:1[89]|20)\d\d\)|\[@[\w:-]+|\bL\. ?Rev\.|'
    r'\bJ\.\s|\bRel(?:ease)?\. No\.|\bFed\. Reg\.|\bet al\.')
SIGNAL_RX = re.compile(r'^(?:(?:see also|see generally|see|but see|but cf\.|cf\.|compare|accord|e\.g\.,?|'
                       r'contra|also)\s*,?\s*)+', re.IGNORECASE)
DATE_PAREN_RX = re.compile(r'\([^()]{0,60}\b(?:1[89]|20)\d\d\)')


def clip(s, n=CLIP):
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= n else s[:n] + '…'


def _balanced(text, i, open_ch, close_ch):
    """Index just past the bracket that closes the one at text[i], or None."""
    depth = 0
    for j in range(i, len(text)):
        c = text[j]
        if c == '\\':
            continue
        if c == open_ch and (j == 0 or text[j - 1] != '\\'):
            depth += 1
        elif c == close_ch and (j == 0 or text[j - 1] != '\\'):
            depth -= 1
            if depth == 0:
                return j + 1
    return None


def unmark(s):
    """Typst / TeX / Markdown markup unwrapped to the words a reader sees."""
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r'#(?:emph|strong|smallcaps|underline|text\([^()]*\)|highlight)\[([^\[\]]*)\];?', r'\1', s)
        s = re.sub(r'#\[([^\[\]]*)\]', r'\1', s)
        s = re.sub(r'\\(?:emph|textit|textsc|textbf|underline)\{([^{}]*)\}', r'\1', s)
    s = re.sub(r'#link\("[^"]*"\)\[([^\[\]]*)\]', r'\1', s)
    s = re.sub(r'#link\("([^"]*)"\)', r'\1', s)
    s = re.sub(r'#cite\(<([^>]+)>(?:,\s*supplement:\s*\[([^\]]*)\])?[^)]*\)',
               lambda m: f'[@{m.group(1)}{", " + m.group(2) if m.group(2) else ""}]', s)
    s = re.sub(r'(?<!\\)[*_]{1,2}([^*_\n]+?)[*_]{1,2}', r'\1', s)
    s = s.replace('---', '—').replace('~', ' ').replace('\\', '')
    s = re.sub(r'(?<=\S)\s*<[A-Za-z][\w.:-]*>', '', s)  # Typst labels
    return s


def _notes(text, ext):
    """(notes, masked): notes in order as {n, line, end_line, raw}; masked is text with each note
    replaced by `[^n]` padded to the same length, newlines kept, so offsets and lines hold."""
    spans = []  # (start, end, body_start, body_end)
    if ext == '.typ':
        for m in re.finditer(r'#footnote\[', text):
            end = _balanced(text, m.end() - 1, '[', ']')
            if end:
                spans.append((m.start(), end, m.end(), end - 1))
    elif ext == '.tex':
        for m in re.finditer(r'\\footnote\{', text):
            end = _balanced(text, m.end() - 1, '{', '}')
            if end:
                spans.append((m.start(), end, m.end(), end - 1))
    else:
        for m in re.finditer(r'\^\[', text):
            end = _balanced(text, m.end() - 1, '[', ']')
            if end:
                spans.append((m.start(), end, m.end(), end - 1))
    spans = [s for k, s in enumerate(spans) if not any(o[0] < s[0] < o[1] for o in spans[:k])]

    defs, order = {}, []
    if ext in ('.md', '.markdown'):
        for m in re.finditer(r'(?m)^\[\^([^\]]+)\]:[ \t]*(.*(?:\n(?:[ \t]{2,}|\t).*)*)', text):
            defs[m.group(1)] = (m.start(), m.end(), m.start(2), m.end(2))
        for m in re.finditer(r'\[\^([^\]]+)\](?!:)', text):
            if m.group(1) in defs and m.group(1) not in order:
                order.append(m.group(1))

    chars = list(text)
    if ext == '.typ':  # figure, table and layout calls: code, not prose
        for m in re.finditer(r'(?m)^[ \t]*#(?:figure|table|grid|block|align|place|image|box|stack|columns)\(', text):
            blank = re.search(r'\n[ \t]*\n', text[m.end():])  # escaped brackets defeat a paren count
            end = m.end() + blank.start() if blank else len(text)
            for k in range(m.start(), end):
                if chars[k] != '\n':
                    chars[k] = ' '
    line_of = lambda off: text.count('\n', 0, off) + 1

    def mask(a, b, label):
        seg = ''.join('\n' if chars[k] == '\n' else ' ' for k in range(a, b))
        lab = label[:max(0, b - a)]
        seg = lab + seg[len(lab):] if '\n' not in seg[:len(lab)] else seg
        chars[a:b] = list(seg)

    found = []
    for a, b, ba, bb in spans:
        found.append(('inline', a, b, ba, bb, None))
    for label in order:
        found.append(('ref', *defs[label], label))
    found.sort(key=lambda f: f[1] if f[0] == 'inline' else
               re.search(r'\[\^' + re.escape(f[5]) + r'\](?!:)', text).start())
    notes, refs = [], {}
    for n, (kind, a, b, ba, bb, label) in enumerate(found, 1):
        notes.append({'n': n, 'line': line_of(a), 'end_line': line_of(max(a, b - 1)),
                      'raw': text[ba:bb], 'label': label})
        tag = re.match(r'\s*<([A-Za-z][\w.:-]*)>', text[b:b + 200]) if ext == '.typ' else None
        if tag:
            refs[tag.group(1)] = n
        if kind == 'inline':
            mask(a, b, f'[^{n}]')
    for n, note in enumerate(notes, 1):
        if note['label'] is not None:
            a, b, _, _ = defs[note['label']]
            mask(a, b, '')
            note['line'] = line_of(a)
            note['end_line'] = line_of(max(a, b - 1))
    masked = ''.join(chars)
    if order:
        num = {f['label']: f['n'] for f in notes if f['label'] is not None}
        masked = re.sub(r'\[\^([^\]]+)\](?!:)',
                        lambda m: f'[^{num[m.group(1)]}]' if m.group(1) in num else m.group(0), masked)
    for note in notes:
        raw = re.sub(r'#ref\(<([^>]+)>\)', lambda m: str(refs.get(m.group(1), '?')), note.pop('raw'))
        note['text'] = clip(unmark(raw), 4000)
        note.pop('label')
    return notes, masked


def sentences(block_lines):
    """[(line, end_line, sentence)] for one body block; a note marker after the full stop is moved
    before it (same length), so the marker stays in the sentence it annotates."""
    text, starts = '', []
    for n, t in block_lines:
        starts.append((len(text), n))
        text += t + ' '
    text = re.sub(r'\s<[A-Za-z][\w.:-]*>', lambda m: ' ' * len(m.group(0)), text)
    text = re.sub(r'([.!?]["\u201d)]?)((?:\[\^\d+\]\s*)+)', lambda m: m.group(2).rstrip() + m.group(1) + ' ' * (len(m.group(2)) - len(m.group(2).rstrip())), text)
    out, pos = [], 0
    for piece in SENT_RX.split(text):
        idx = text.find(piece, pos)
        pos = idx + len(piece)
        line = max(n for off, n in starts if off <= max(idx, 0))
        end = max(n for off, n in starts if off <= max(pos - 1, 0))
        s = re.sub(r'\s+', ' ', unmark(piece)).strip()
        if s:
            out.append((line, end, s))
    return out


HEAD_RX = {
    '.md': re.compile(r'^\s*#{1,6}\s+(.*)$'), '.markdown': re.compile(r'^\s*#{1,6}\s+(.*)$'),
    '.typ': re.compile(r'^\s*=+\s+(.*)$'),
    '.tex': re.compile(r'^\s*\\(?:sub)*section\*?\{(.*)\}'),
}


def load(files):
    """[{file, ext, notes, paras: [{line, kind, sentences:[(line, end, text)]}], headings:[(line, title)]}]"""
    out = []
    for rel, a in prose_files(files):
        lines = _read(a)
        if lines is None:
            continue
        ext = '.' + rel.rsplit('.', 1)[-1].lower()
        notes, masked = _notes('\n'.join(lines), ext)
        mlines = masked.split('\n')
        paras = []
        for kind, first, bl in blocks(mlines, ext):
            ss = ([(n, n, re.sub(r'\s+', ' ', unmark(t)).strip()) for n, t in bl] if kind == 'list'
                  else sentences(bl))
            ss = [s for s in ss if s[2] and not re.fullmatch(r'(\[\^\d+\]\s*)+', s[2])]
            if ss:
                paras.append({'line': first, 'kind': kind, 'sentences': ss})
        hrx = HEAD_RX.get(ext)
        heads = [(i + 1, clip(unmark(m.group(1)), 120)) for i, t in enumerate(lines)
                 if hrx and (m := hrx.match(t))]
        out.append({'file': rel, 'ext': ext, 'notes': notes, 'paras': paras, 'headings': heads})
    return out


def heading_at(doc, line):
    h = [t for n, t in doc['headings'] if n <= line]
    return h[-1] if h else 'front matter (before the first heading: title, abstract)'


def touches(changed, file, lo, hi):
    """True when the line span [lo, hi] meets the round's changed lines, or there is no diff info."""
    if changed is None or file not in changed:
        return True
    return any(a <= hi and lo <= b for a, b in changed[file])


def clauses(note_text):
    """A footnote split into its citation clauses: on semicolons outside parentheses and brackets."""
    out, depth, cur = [], 0, ''
    for c in note_text:
        if c in '([':
            depth += 1
        elif c in ')]' and depth:
            depth -= 1
        if c == ';' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += c
    if cur.strip():
        out.append(cur.strip())
    return out


def citing(clause):
    """Whether a clause cites an authority, judged on the clause outside its parentheticals."""
    bare = re.sub(r'\([^()]*\)', ' ', clause)
    return bool(CITE_RX.search(bare)) or bool(DATE_PAREN_RX.search(clause)) or bool(re.search(r'\b[A-Z][\w.\'&-]+ v\. [A-Z]', bare))


def scope_note(changed):
    return ('only spans on lines the round added or changed are listed; unchanged ones are out of scope'
            if changed is not None else None)


def pieces(note_text):
    """A footnote's citation sentences, each split into its semicolon clauses, in order."""
    return [c for part in SENT_RX.split(note_text) for c in clauses(part) if c]


KINDS = [
    ('case', re.compile(r"\b[A-Z][\w.'&-]*(?:\s+[\w.'&-]+){0,6}\s+v\.\s+[A-Z]|\bIn re\b|\b\d+\s+(?:U\.S\.|S\. ?Ct\.|"
                        r"F\.(?:\s?Supp\.)?(?:\s?\d[dh])?|A\.(?:\d[dh])?|N\.E\.|N\.W\.|S\.E\.|S\.W\.|So\.|P\.(?:\d[dh])?|"
                        r"Cal\. Rptr\.|N\.Y\.S\.|WL)\s+\d")),
    ('statute', re.compile(r'\bU\.S\.C\.|\bStat\.\s+\d|\bCode Ann\.|\b(?:Act|Code) (?:of \d{4} )?§|\btit\.\s+\d+,?\s+§|'
                           r'\b(?:Corporation|Business) (?:Law|Code)\b,? (?:Section|§)\s*\d')),
    ('constitution', re.compile(r'\bConst\.\s')),
    ('regulation', re.compile(r'\bC\.F\.R\.|\bReg\.\s+[A-Z]-?\d|\bFed\. Reg\.')),
    ('restatement or model code', re.compile(r'\bRestatement\b|\bModel (?:Bus\. Corp\. )?(?:Act|Code)\b|\bU\.C\.C\.')),
    ('release', re.compile(r'\bRelease No\.|\bRel\. No\.|\bFed\. Reg\.')),
    ('hearing', re.compile(r'\bHearings?\b')),
    ('bill or other legislative material', re.compile(r'\bH\.R\. \d|(?<![\w.])S\. \d+\b|\bCong\.|\b\d+(?:st|nd|rd|th) Congress\b|'
                                                      r'\bRep\. No\.')),
    ('periodical article', re.compile(r'\b\d+\s+(?:[A-Z][\w.&\']*\s){1,6}\d+(?:,\s*\d+)?(?:[-–]+\d+)?\s*\(\d{4}\)|L\. ?Rev\.|\bJ\.\s')),
    ('court filing', re.compile(r'\bComplaint\b|\bBrief\b|\bMotion\b|\bPetition\b')),
    ('web or news source', re.compile(r'https?://|perma\.cc|\b(?:Jan|Feb|Mar|Apr|May|June|July|Aug|Sept|Oct|Nov|Dec)\.? \d{1,2}, \d{4}')),
    ('book or report', re.compile(r'\(\d{4}\)|\(\d+(?:st|nd|rd|th) ed\.|\beds?\.,')),
]


def authority_kinds(text):
    """Regex hints of what kind of authority a citation is; a hint, never the verdict."""
    return [k for k, rx in KINDS if rx.search(text or '')]
