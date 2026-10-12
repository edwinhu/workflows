"""Shared prose extraction for the writing rules: paragraphs and sentences with file:line.

Only prose is kept -- frontmatter, code fences, tables, headings, HTML/TeX comments and Typst
markup lines are dropped, so a rule's candidate spans are sentences a reader reads.
"""
import re

from _common import _read

PROSE_EXT = ('.md', '.markdown', '.typ', '.tex')
# planning, outlines and sources are not the deliverable; an outline is SUPPOSED to be bullets
SKIP_DIRS = {'.planning', '.claude', 'outlines', 'sources', 'node_modules'}

LIST_RX = re.compile(r'^\s*(?:[-*+]|\d+[.)])\s+')
ABBREV = ''.join(rf'(?<!\b{a}\.)' for a in
                 (r'e\.g', r'i\.e', 'v', 'vs', 'No', 'Inc', 'Co', r'U\.S', 'et al', 'cf', 'p', 'pp',
                  'Id', 'id', 'Mr', 'Ms', 'Dr', 'Sec', 'Art', 'Fig', 'al'))
SENT_RX = re.compile(r'(?<=[.!?])' + ABBREV + r'["\u201d)]?\s+(?=["\u201c(]?[A-Z0-9])')


def prose_files(files):
    """The (label, path) pairs that are the prose deliverable: drafts/ when any is present."""
    keep = [(r, a) for r, a in files
            if r.lower().endswith(PROSE_EXT) and not (set(r.split('/')[:-1]) & SKIP_DIRS)]
    drafts = [(r, a) for r, a in keep if 'drafts' in r.split('/')[:-1]]
    return drafts or keep


def _strip_inline(t):
    t = re.sub(r'`[^`]*`', 'CODE', t)
    t = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', t)
    return t.strip()


def blocks(lines, ext):
    """[(kind, first_line_no, [(line_no, text), ...])] where kind is 'para' or 'list'."""
    out, cur, kind = [], [], None
    fence, front = False, False

    def flush():
        nonlocal cur, kind
        if cur:
            out.append((kind, cur[0][0], cur))
        cur, kind = [], None

    for i, raw in enumerate(lines):
        n, s = i + 1, raw.rstrip()
        st = s.strip()
        if i == 0 and st == '---' and ext in ('.md', '.markdown'):
            front = True
            continue
        if front:
            if st in ('---', '...'):
                front = False
            continue
        if st.startswith(('```', '~~~')):
            flush()
            fence = not fence
            continue
        if fence:
            continue
        skip = (not st or st.startswith(('|', '<!--', '-->'))
                or (ext in ('.md', '.markdown') and st.startswith('#'))
                or (ext == '.typ' and (st.startswith(('=', '#', '//', '<', '@'))))
                or (ext == '.tex' and (st.startswith(('%', '\\begin', '\\end', '\\section', '\\subsection', '\\label'))
                                       or re.match(r'\\[a-zA-Z]+\*?(\[[^\]]*\])?\{[^}]*\}\s*$', st))))
        if skip:
            flush()
            continue
        k = 'list' if LIST_RX.match(s) else 'para'
        if kind == 'list' and k == 'para' and raw[:1] in (' ', '\t'):
            k = 'list'   # an indented continuation of a list item
        if kind and k != kind:
            flush()
        kind = k
        cur.append((n, _strip_inline(LIST_RX.sub('', s) if k == 'list' else s)))
    flush()
    return out


def sentences(block_lines):
    """[(line_no, sentence)] for one block; a sentence is pinned to the line it starts on."""
    text, starts = '', []
    for n, t in block_lines:
        starts.append((len(text), n))
        text += t + ' '
    out, pos = [], 0
    for piece in SENT_RX.split(text):
        idx = text.find(piece, pos)
        pos = idx + len(piece)
        line = max(n for off, n in starts if off <= max(idx, 0))
        if piece.strip():
            out.append((line, piece.strip()))
    return out


def paragraphs(files):
    """[{'file','line','kind','sentences':[(line,text)]}] over the prose deliverable."""
    out = []
    for rel, abs_path in prose_files(files):
        lines = _read(abs_path)
        if lines is None:
            continue
        ext = '.' + rel.rsplit('.', 1)[-1].lower()
        for kind, first, bl in blocks(lines, ext):
            ss = [(n, t) for n, t in bl] if kind == 'list' else sentences(bl)
            out.append({'file': rel, 'line': first, 'kind': kind, 'sentences': ss})
    return out


def prose_search(files, pattern, what, keep=40, flags=re.IGNORECASE):
    """A _search-shaped record over prose SENTENCES only: absence is recorded as an empty list."""
    rx = re.compile(pattern, flags)
    pf = prose_files(files)
    paras = paragraphs(files)
    per_file, total, n_sent = [], 0, 0
    for rel, _ in pf:
        ss = [(n, t) for p in paras if p['file'] == rel for n, t in p['sentences']]
        n_sent += len(ss)
        hs = [(n, t) for n, t in ss if rx.search(t)]
        total += len(hs)
        per_file.append({'file': rel, 'readable': True, 'n_lines': len(ss), 'n_matches': len(hs),
                         'matches': [{'line': n, 'text': t[:300]} for n, t in hs[:keep]]})
    return {'what': what, 'pattern': pattern, 'files': [r for r, _ in pf],
            'lines_searched': n_sent, 'total_matches': total, 'per_file': per_file}


def span(p, i):
    """One candidate sentence with its neighbours, so the judge sees what it does in place."""
    ss = p['sentences']
    n, t = ss[i]
    return {'file': p['file'], 'line': n, 'sentence': t[:400],
            'before': ss[i - 1][1][:250] if i > 0 else None,
            'after': ss[i + 1][1][:250] if i + 1 < len(ss) else None}
