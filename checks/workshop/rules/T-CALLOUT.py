"""T-CALLOUT: a `#callout` box quotes source text. Diff-scoped calibration 2026-10-02, two consecutive two-run rounds: vio 1.00, sat and the charter question callouts <= 0.01; accepted decks that quote in callouts (Tornetta-short 01.typ:135, 99-landscape Clark) are legacy bases, new quoting callout 0.98-1.00, new question/caution callout <= 0.01."""
from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, clip, heading, in_changed, scope_note

PROPOSITION = ('A `#callout` box is used as a quoting device: at least one callout carries quoted source '
               'text -- statutory language, an opinion, a paper, a filing or a person\'s words, usually in '
               'quotation marks or with an attribution -- where callouts are reserved for warnings, caveats, '
               'questions and important notes. Quotes belong in plain text or a `#quote()` block.')

CRITERIA = {
    'VIOLATED': 'at least one listed callout quotes source text',
    'SATISFIED': 'every listed callout is a warning, caveat, question or note in the deck\'s own words',
    'NOT_APPLICABLE': 'the state lists no callout',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('callouts',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'


def _body(text, start):
    """The `[...]` content of the call opening at `start`, balanced; '' when there is none."""
    i = text.find('[', start)
    if i < 0:
        return '', start
    # the marker argument `(marker: [...])` precedes the body: skip a parenthesised argument list
    p = text.find('(', start)
    if 0 <= p < i and text[start:p].strip() == '#callout':
        d = 0
        for k in range(p, len(text)):
            d += {'(': 1, ')': -1}.get(text[k], 0)
            if d == 0:
                i = text.find('[', k)
                break
    d = 0
    for k in range(i, len(text)):
        d += {'[': 1, ']': -1}.get(text[k], 0)
        if d == 0:
            return text[i + 1:k], k
    return text[i + 1:], len(text)


def evidence(files, plan_lines=None, changed=None):
    out, skipped, n_lines = [], 0, 0
    for rel, a in files:
        if not rel.lower().endswith('.typ'):
            continue
        lines = _read(a)
        if lines is None:
            continue
        n_lines += len(lines)
        text = '\n'.join(lines)
        offs = [0]
        for t in lines:
            offs.append(offs[-1] + len(t) + 1)
        pos = 0
        while (s := text.find('#callout', pos)) >= 0:
            body, end = _body(text, s)
            pos = max(end, s + 1)
            line = next(n for n in range(len(offs)) if offs[n + 1] > s) + 1
            end_line = next(n for n in range(len(offs)) if offs[n + 1] > end) + 1
            if lines[line - 1].lstrip().startswith('//'):
                continue
            if not in_changed(changed, rel, line, end_line):
                skipped += 1
                continue
            title = next((h[1] for k in range(line - 1, -1, -1) if (h := heading(lines[k])) and h[0] == 3), None)
            out.append({'file': rel, 'line': line, 'slide_subtitle': clip(title, 160) if title else None,
                        'callout_body': clip(body, 500),
                        'has_quotation_marks': any(q in body for q in ('"', '“', '”'))})
    inventory = {
        'n_lines_searched': n_lines,
        'callouts': out[:MAX_ITEMS],
        'n_callouts': len(out),
        **scope_note(changed, skipped),
    }
    return render_json('T-CALLOUT', [(r, a) for r, a in files if r.lower().endswith('.typ')], inventory, [])
