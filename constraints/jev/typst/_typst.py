"""Shared extraction for the Typst deck/notes rules: slides, notes bullets and sections, with file:line.

A file is NOTES when its name or a parent directory says notes; every other .typ is a DECK. Rules
read only the kind they are about, so a deck rule finds nothing to judge in a notes file.
"""
import re


DELIVERABLE = 'typst'
SUBJECT = 'one Typst slide deck and its speaker notes'
MAX_ITEMS = 40      # per inventory list; the state must stay well inside rule-check's 60000 chars
TEXT = 300

HEADING = re.compile(r'^\s*(=+)\s+(\S.*?)\s*$')
BULLET = re.compile(r'^(\s*)-\s+(.*)$')
SLIDE_OPEN = re.compile(r'^\s*#(?:(?:hidden-)?slide\s*(?:\(|\[)|pagebreak\b)')
DQ_TITLE = re.compile(r'^Discussion Questions?\b', re.IGNORECASE)


def clip(s, n=TEXT):
    s = re.sub(r'\s+', ' ', s).strip()
    return s if len(s) <= n else s[:n] + '…'


def kind(rel):
    parts = rel.lower().split('/')
    return 'notes' if any('notes' in p for p in parts) else 'deck'


def typ_files(files, want):
    return [(r, a) for r, a in files if r.lower().endswith('.typ') and kind(r) == want]


def uncomment(line):
    """The line with a trailing `//` comment removed; a URL's `://` is not a comment."""
    return re.sub(r'(?<!:)//.*$', '', line).rstrip()


def in_changed(changed, rel, lo, hi=None):
    """True when [lo, hi] meets the round's changed lines; a file with no diff info is all in scope."""
    if changed is None or rel not in changed:
        return True
    hi = lo if hi is None else hi
    return any(a <= hi and lo <= b for a, b in changed[rel])


def _depth(s):
    """Net parentheses outside `[...]` content blocks: a code call left open by this line."""
    d, sq = 0, 0
    for c in s:
        if c == '[':
            sq += 1
        elif c == ']':
            sq = max(0, sq - 1)
        elif not sq and c == '(':
            d += 1
        elif not sq and c == ')':
            d -= 1
    return d


def content_lines(lines, lo, hi):
    """[(n, text)] of the rendered markup in lines[lo:hi]: bullets and prose, never code, a code
    call's arguments, comments, pauses or blank lines."""
    out, depth = [], 0
    for j in range(lo, hi):
        u = uncomment(lines[j])
        s = u.strip()
        if depth > 0:
            depth = max(0, depth + _depth(s))
            continue
        if s.startswith('#'):
            depth = max(0, _depth(s))
            continue
        if not s or s.startswith((']', ')', '[')):
            continue
        s = re.sub(r'#pause\b', '', s)
        m = BULLET.match(s)
        out.append((j + 1, (m.group(2) if m else s).strip()))
    return out


def heading(line):
    """(level, text) of a heading line, or None."""
    m = HEADING.match(uncomment(line))
    return (len(m.group(1)), m.group(2)) if m else None


def slides(lines):
    """[{'line','title','body':[(n,text)],'end'}] for each `===` subtitle: the slide runs to the next
    heading or slide opener. `body` holds rendered markup lines only."""
    starts = [i for i, t in enumerate(lines) if (h := heading(t)) and h[0] == 3]
    out = []
    for s in starts:
        end = len(lines)
        for j in range(s + 1, len(lines)):
            if heading(lines[j]) or SLIDE_OPEN.match(uncomment(lines[j])):
                end = j
                break
        out.append({'line': s + 1, 'title': heading(lines[s])[1], 'end': end,
                    'body': content_lines(lines, s + 1, end)})
    return out


def bullets(lines):
    """[(line, indent, text)] for every notes bullet, continuation lines joined."""
    out = []
    cur = None
    for i, raw in enumerate(lines):
        u = uncomment(raw)
        m = BULLET.match(u)
        if m:
            cur = [i + 1, len(m.group(1)), m.group(2).strip()]
            out.append(cur)
            continue
        s = u.strip()
        if not s or HEADING.match(u) or s.startswith('#'):
            cur = None
            continue
        if cur is not None and len(u) - len(u.lstrip()) > cur[1]:
            cur[2] += ' ' + s
    return [(n, ind, clip(t)) for n, ind, t in out]


def sections(lines):
    """[{'line','heading','level','bullets':[(n,indent,text)]}] for each `=`/`==` heading of a notes file;
    `subheads` are its `===` lines."""
    heads = [(i, h[0], h[1]) for i, t in enumerate(lines) if (h := heading(t)) and h[0] <= 2]
    bl = bullets(lines)
    out = []
    for k, (i, lvl, h) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        subs = [(j + 1, hh[1]) for j in range(i + 1, end) if (hh := heading(lines[j])) and hh[0] == 3]
        out.append({'line': i + 1, 'level': lvl, 'heading': h, 'end': end,
                    'subheads': subs, 'bullets': [b for b in bl if i < b[0] <= end]})
    return out


def kind_note(files, want):
    got = typ_files(files, want)
    return {f'{want}_files_examined': [r for r, _ in got],
            'files_not_of_this_kind': [r for r, _ in files if (r, _) not in got][:20]}


def scope_note(changed, skipped):
    if changed is None:
        return {}
    return {'n_skipped_unchanged': skipped,
            'diff_scope_note': 'only spans on lines the round added or changed are listed; unchanged '
                               'spans are out of scope, counted in n_skipped_unchanged, and never a violation'}


def added_state(rule, files, key, items):
    """With diff info, the state Jev judges: the added spans with only the neighbours needed to judge
    them. Legacy spans, their counts and the file's length stay out, or their register leaks in."""
    from _common import render_json
    named = {i['file'] for i in items}
    return render_json(rule, [(r, None) for r, _ in files if r in named], {
        key: items[:MAX_ITEMS],
        'scope_note': 'only what this round added is listed, each with the neighbouring lines needed to '
                      'judge it; the rest of the file is not under review'}, [])
