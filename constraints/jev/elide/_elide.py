"""Shared extraction for the elide-case rules: an addendum .typ parsed into readings and lines.

Every line of a reading is classified -- caption, note (an editors' note), footnote (the retained
footnote block or endnotes), heading, break (a centred `* * *`), body (the court's text) -- so a rule
looks only at the spans it is about, each with file:line. The court's text is `body`; the editors'
voice is `note`. The parse is line-based on purpose: it is what the addenda in the course repos look
like, and a candidate pinned to a line is one the judge and the author can both find.
"""
import re

from _common import _read

# an addendum fragment or an assembled addendum; anything else in a changed set is not an excerpt
ADDENDUM_RX = re.compile(r'(^|/)addenda/[^/]+\.typ$|addendum[^/]*\.typ$', re.IGNORECASE)

CAPTION_RX = re.compile(r'#text\(\s*13pt\s*,\s*weight:\s*"bold"\s*\)\s*\[(?P<t>[^\]]+)\]')
NOTE_START_RX = re.compile(r"Editors(?:['\u2019]|\\u\{2019\})?\s+note", re.IGNORECASE)
FOOTNOTE_HEAD_RX = re.compile(r'Retained footnote|^\s*\*\s*(END)?NOTES\s*\*\s*$|^\s*\*\s*FOOTNOTES\s*\*\s*$',
                              re.IGNORECASE)
RULE_LINE_RX = re.compile(r'^\s*#line\(\s*length')
BREAK_RX = re.compile(r'^\s*#align\(center\)\s*\[\s*(\\\*\s*){2,}\]\s*$')
HEADING_RX = re.compile(r'^\s*(=+)\s+(?P<h>.+)$|^\s*\*(?P<b>[^*]{1,140})\*\s*$')
# the editors' own elision mark: a BRACKETED ellipsis. An unbracketed `. . .` is the court's.
ELISION_RX = re.compile(r'\[\s*(?:\.\s*){3,4}\]|\[\s*\u2026\s*\]|\[\s*\\u\{2026\}\s*\]')
# a sentence ends at . ! ? (plus any closing quote, paren or emphasis mark) before whitespace and a
# capital, a digit, an opening quote or an elision mark; the listed abbreviations never end one
SENT_END_RX = re.compile(r'(?<=[.!?])(?<!\bv\.)(?<!\bU\.S\.)(?<!\bId\.)(?<!\bid\.)(?<!\bCo\.)(?<!\bInc\.)'
                         r'(?<!\bNo\.)(?<!\bat\.)(?<!\bi\.e\.)(?<!\be\.g\.)(?<!\bJ\.)(?<!\bC\.)(?<!\bS\.)'
                         r'["\u201d\u2019)_]*(?P<gap>\s+)(?=[\u201c"(_]*[A-Z0-9]|\[\s*\.|\[[A-Z])')


def unescape(t):
    t = re.sub(r'\\u\{([0-9a-fA-F]+)\}', lambda m: chr(int(m.group(1), 16)), t)
    t = t.replace('\\$', '$').replace('\\*', '*').replace('\\#', '#').replace('\\@', '@')
    return t.replace('---', '\u2014').replace('--', '\u2013').replace('~', ' ')


def clean(t):
    """Display text: Typst emphasis and calls folded away, escapes resolved."""
    t = re.sub(r'#emph\s*\[', '', unescape(t))
    t = re.sub(r'#[a-zA-Z.]+(\([^)]*\))?\[?', '', t)
    return t.replace('_', '').strip()


def addendum_files(files):
    return [(r, a) for r, a in files if ADDENDUM_RX.search(r)]


def _depth(s):
    return s.count('[') - s.count(']')


def parse(lines):
    """{'preamble': [(n, kind, text)], 'readings': [{'title', 'line', 'lines': [(n, kind, text)]}]}."""
    readings, cur = [], None
    preamble = []
    block, block_kind = 0, None      # an open #text(10pt)[ / #align(center)[ / #emph[ block
    zone = None                      # 'footnote' once a reading's footnote zone begins
    for i, raw in enumerate(lines):
        n, s = i + 1, raw.rstrip()
        st = s.strip()
        m = CAPTION_RX.search(s)
        if m:
            cur = {'title': clean(m.group('t')), 'line': n, 'lines': []}
            readings.append(cur)
            zone = None
            block, block_kind = max(block, 1), 'caption'
            continue
        target = cur['lines'] if cur else preamble
        if block > 0:
            block += _depth(s)
            kind = block_kind
            if block_kind in ('small', 'note', 'footnote') and FOOTNOTE_HEAD_RX.search(s):
                kind = block_kind = 'footnote'
            elif block_kind in ('small', 'footnote') and NOTE_START_RX.search(s):
                kind = block_kind = 'note'
            if kind == 'small':
                kind = 'note'
            if block <= 0:
                block, block_kind = 0, None
            if st and kind != 'caption' and not st.startswith('#') and st not in (']', ']]'):
                target.append((n, kind, st))
            continue
        if not st or st.startswith('//') or st in (']', ']]'):
            continue
        if st.startswith('#align(center)') and BREAK_RX.match(st):
            target.append((n, 'break', st))
            continue
        if st.startswith('#align(center)'):
            block, block_kind = _depth(s), 'caption'
            if block <= 0:
                block, block_kind = 0, None
            continue
        if RULE_LINE_RX.match(st):
            zone = 'footnote' if cur else None
            continue
        if re.match(r'#text\(\s*(9|10)pt\s*\)\s*\[', st):
            block, block_kind = _depth(s), ('footnote' if zone == 'footnote' else 'small')
            if NOTE_START_RX.search(st):
                block_kind = 'note'
            rest = st[st.index('[') + 1:].strip()
            if block <= 0:
                block, block_kind = 0, None
            if rest:
                target.append((n, 'note' if NOTE_START_RX.search(rest) else 'footnote', rest))
            continue
        if NOTE_START_RX.search(st) and st.startswith(('#emph', '*[', '_[', '[')):
            target.append((n, 'note', st))
            if st.startswith('#emph'):
                d = _depth(st)
                if d > 0:
                    block, block_kind = d, 'note'
            continue
        if FOOTNOTE_HEAD_RX.search(st):
            zone = 'footnote' if cur else None
            continue
        if zone == 'footnote' and not st.startswith('#'):
            target.append((n, 'footnote', st))
            continue
        if st.startswith('#'):
            continue
        h = HEADING_RX.match(st)
        if h:
            target.append((n, 'heading', (h.group('h') or h.group('b')).strip()))
            continue
        target.append((n, 'body' if cur else 'preamble', st))
    return {'preamble': preamble, 'readings': readings}


def sentences(text):
    """The sentences of one body line (an addendum paragraph is one line), closing quotes kept."""
    out, at = [], 0
    for m in SENT_END_RX.finditer(text):
        out.append(text[at:m.start('gap')])
        at = m.end('gap')
    out.append(text[at:])
    return [x.strip() for x in out if x.strip()]


def in_changed(changed, label, lo, hi=None):
    """True when no diff info covers this file, or [lo, hi] overlaps a changed range."""
    if changed is None or label not in changed:
        return True
    hi = lo if hi is None else hi
    return any(a <= hi and lo <= b for a, b in changed[label])


def addenda(files):
    """[(label, parsed)] for each readable addendum file."""
    out = []
    for rel, a in addendum_files(files):
        lines = _read(a)
        if lines is None:
            continue
        out.append((rel, parse(lines)))
    return out


def plan_target(plan_lines):
    """The plan's three Doctrinal target answers, or None when no plan was supplied."""
    if not plan_lines:
        return None
    got = {}
    for ln in plan_lines:
        m = re.match(r'^\s*[-*]?\s*(Doctrinal thread|Cuts against|Taught for)\s*:\s*(.*)$', ln, re.IGNORECASE)
        if m:
            got[m.group(1).lower()] = m.group(2).strip()[:400]
    return got or None


def body_lines(files, changed=None):
    """[(label, reading title, line, text, section)] for the court's text, diff-scoped when known.
    `section` is the nearest heading above the line, so the judge sees where in the opinion it sits."""
    out = []
    for rel, p in addenda(files):
        for r in p['readings']:
            section = None
            for n, k, t in r['lines']:
                if k == 'heading':
                    section = clean(t)[:120]
                elif k == 'body' and in_changed(changed, rel, n):
                    out.append((rel, r['title'], n, t, section))
    return out


def notes(files):
    """[(label, reading title or None for the preamble, first line, text)] for each editors' note."""
    out = []
    for rel, p in addenda(files):
        for title, lines in [(None, p['preamble'])] + [(r['title'], r['lines']) for r in p['readings']]:
            cur = None
            for n, k, t in lines:
                if k == 'note':
                    if cur is None:
                        cur = [rel, title, n, []]
                        out.append(cur)
                    cur[3].append(clean(t).strip('[]'))
                else:
                    cur = None
    return [(a, b, c, ' '.join(d)[:2500]) for a, b, c, d in out]
