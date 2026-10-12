import re

from _common import render_json
from _elide import ELISION_RX, addenda, addendum_files, body_lines, clean, in_changed, notes, sentences

DELIVERABLE = 'casebook-excerpt'
SUBJECT = 'one casebook excerpt (a court opinion cut into a student reading)'

PROPOSITION = ('The retained text shows a cut the reader is never told about: a heading sequence or an ordinal '
               'enumeration skips a member (Part I then Part III; "First" then "Third"; "four reasons" with two '
               'kept), and nothing tells the reader text was removed there -- no elision mark or centred break '
               'at that point, and no editors\' note or preamble statement that omissions between sentences or '
               'paragraphs go unmarked.')

CRITERIA = {
    'VIOLATED': 'at least one listed gap has no mark at that point and no note or preamble statement covering '
                'unmarked omissions, so a student would read the sequence as complete',
    'SATISFIED': 'every gap is marked where it falls or covered by a stated omission convention, or there is no gap',
    'NOT_APPLICABLE': 'the excerpt has no headings and no enumerations',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('gaps',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_body_lines_searched'

ROMAN = {r: i + 1 for i, r in enumerate('I II III IV V VI VII VIII IX X XI XII XIII XIV XV'.split())}
ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6}
ORD_RX = re.compile(r'^[“"(\[]*(first|second|third|fourth|fifth|sixth)\b[,:]?', re.IGNORECASE)
COUNT_RX = re.compile(r'\b(two|three|four|five|six)\s+(?:\w+\s+){0,2}(reasons|grounds|flaws|defects|factors|'
                      r'prongs|questions|elements|steps|requirements|considerations|problems|issues)\b', re.IGNORECASE)
WORDNUM = {'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6}
DISCLOSE_RX = re.compile(r'omi(t|ss)|elid|elision|cut\b|excerpt|ellips', re.IGNORECASE)


def _label(h):
    m = re.match(r'^\s*(?:Part\s+)?([IVX]+|[A-Z]|\d+)(?:[.)]|\s*$|\s)', h)
    if not m:
        return None
    v = m.group(1)
    if v in ROMAN:
        return (1, ROMAN[v], v)
    if v.isdigit():
        return (3, int(v), v)
    return (2, ord(v) - 64, v)


def _ends_on_mark(text):
    return bool(re.search(ELISION_RX.pattern + r'\s*$', text.strip()))


def evidence(files, plan_lines=None, changed=None):
    gaps, n_headings, n_ordinals = [], 0, 0
    for rel, p in addenda(files):
        for r in p['readings']:
            last = {}
            seen_ord = set()
            pending_count = None
            prev_head = None
            before = None            # the last body or break line: what sits immediately above a heading
            mark_since_ordinal = False
            for n, k, t in r['lines']:
                if k == 'break':
                    before, mark_since_ordinal = ('break', n, t), True
                    continue
                if k == 'heading':
                    lab = _label(clean(t))
                    if not lab:
                        continue
                    n_headings += 1
                    lvl, val, txt = lab
                    exp = last.get(lvl, 0) + 1
                    if val != exp and in_changed(changed, rel, n):
                        marked = bool(before) and (before[0] == 'break' or _ends_on_mark(before[2]))
                        gaps.append({'file': rel, 'line': n, 'reading': r['title'], 'kind': 'heading',
                                     'found': clean(t)[:120], 'expected_label_number': exp,
                                     'previous_heading': prev_head,
                                     'line_immediately_above': None if not before else
                                         {'line': before[1], 'text': clean(before[2])[-160:]},
                                     'a_mark_or_centred_break_immediately_above': marked})
                    last[lvl] = val
                    for deeper in [x for x in last if x > lvl]:
                        del last[deeper]
                    prev_head = clean(t)[:120]
                    seen_ord, pending_count = set(), None
                    continue
                if k != 'body':
                    continue
                before = ('body', n, t)
                for s in sentences(t):
                    if ELISION_RX.search(s):
                        mark_since_ordinal = True
                    cm = COUNT_RX.search(s)
                    if cm:
                        pending_count = {'line': n, 'sentence': clean(s)[:300], 'announced': WORDNUM[cm.group(1).lower()]}
                        seen_ord = set()
                    om = ORD_RX.match(clean(s))
                    if not om:
                        continue
                    n_ordinals += 1
                    v = ORD[om.group(1).lower()]
                    if v == 1:
                        seen_ord = set()
                    if v > 1 and (v - 1) not in seen_ord and in_changed(changed, rel, n):
                        gaps.append({'file': rel, 'line': n, 'reading': r['title'], 'kind': 'ordinal',
                                     'found': clean(s)[:300], 'missing': [x for x in range(1, v) if x not in seen_ord],
                                     'announcement': pending_count,
                                     'a_mark_or_centred_break_since_the_previous_ordinal': mark_since_ordinal})
                    seen_ord.add(v)
                    mark_since_ordinal = False
                    if pending_count:
                        pending_count['ordinals_seen'] = sorted(seen_ord)
    disclosures = [{'file': f, 'reading': t or '(preamble)', 'line': n,
                    'omission_statements': [s[:300] for s in sentences(x) if DISCLOSE_RX.search(s)][:6]}
                   for f, t, n, x in notes(files)]
    inventory = {
        'n_body_lines_searched': len(body_lines(files)),
        'gaps': gaps[:30],
        'n_gaps': len(gaps),
        'n_numbered_headings': n_headings,
        'n_ordinal_sentences': n_ordinals,
        'note_and_preamble_omission_statements': [d for d in disclosures if d['omission_statements']],
    }
    return render_json('EL-GAP', addendum_files(files), inventory, [])
