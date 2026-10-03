import re

from _common import _read, render_json
from _authoring import SUBJECT, DELIVERABLE, MAX_ITEMS, kind, changed_set, body, blocks, clip  # noqa: F401

PROPOSITION = ('A changed gate, phase exit condition, acceptance clause or loop-termination condition is '
               'settled by judgement -- "looks good", "quality is sufficient", "the reviewer approves", '
               '"until no more issues are found", re-running an open-ended critique -- rather than by a '
               'decidable check: a command\'s exit code, a file containing a string, a schema or lint '
               'rule, a count against a threshold. One advisory pass that gates nothing does not count.')

CRITERIA = {
    'VIOLATED': 'at least one changed gate or loop exit depends on a judgement or a prose review instead '
                'of a decidable check',
    'SATISFIED': 'every changed gate or loop exit names a decidable check (exit code, string present, '
                 'lint rule, count), or the judgement is explicitly advisory and gates nothing',
    'NOT_APPLICABLE': 'the change adds or edits no gate, exit condition, acceptance clause or loop exit',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('changed_gate_or_loop_passages',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'

GATE_SECTION = re.compile(r'\bgate|\bexit|acceptance|done when|success criteria|review loop|verif', re.I)
GATE_LINE = re.compile(r'\bgate\b|\bexit (condition|criteri)|\bacceptance\b|\bdone when\b|\buntil\b|'
                       r'\bpass(es)? when\b|\bloop\b|\bproceed (only )?(when|once|if)\b', re.I)
DECIDABLE = re.compile(r'exit code|exits? [0-9]|`[^`]+`|\bcontains\b|\bgrep\b|\blint\b|\bschema\b|'
                       r'\bcount\b|>=|<=|\bthreshold\b', re.I)


def evidence(files, plan_lines=None, changed=None):
    gates, examined, n_lines = [], [], 0
    for rel, a in files:
        if not rel.endswith('.md') or kind(rel) == 'planning':
            continue
        lines = _read(a)
        if lines is None:
            continue
        examined.append(rel)
        n_lines += len(lines)
        touched = changed_set(rel, changed, len(lines))
        for b in blocks(body(lines)):
            rows = [r for r in b if r[0] in touched]
            if not rows:
                continue
            if not (GATE_SECTION.search(b[0][2]) or any(GATE_LINE.search(t) for _, t, _ in rows)):
                continue
            text = ' '.join(t.strip() for _, t, _ in b[:8])
            if text.startswith('#') and len(b) == 1:
                continue
            gates.append({'file': rel, 'line': rows[0][0], 'section': b[0][2], 'text': clip(text, 800),
                          'names_a_decidable_check': bool(DECIDABLE.search(text))})
    gates.sort(key=lambda g: (g['names_a_decidable_check'], g['file'], g['line']))
    inventory = {
        'files_examined': examined,
        'changed_gate_or_loop_passages': gates[:MAX_ITEMS],
        'n_changed_gate_or_loop_passages': len(gates),
        'n_lines_searched': n_lines,
        'n_naming_no_decidable_check': sum(1 for g in gates if not g['names_a_decidable_check']),
    }
    return render_json('A-GATE', [(r, a) for r, a in files if r.endswith('.md') and kind(r) != 'planning'], inventory, [])
