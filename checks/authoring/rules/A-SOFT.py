import re

from _common import _read, render_json
from _authoring import SUBJECT, DELIVERABLE, MAX_ITEMS, kind, changed_set, body, blocks, clip  # noqa: F401

PROPOSITION = ('A changed Iron Law, EXTREMELY-IMPORTANT block or absolute NEVER/ALWAYS rule states its '
               'constraint in soft language -- "should", "try to", "consider", "prefer", "ideally", '
               '"where possible", "generally" -- so the constraint itself reads as a guideline. Soft '
               'words inside the explanation of why, or a qualifier naming a precise checkable '
               'exception, do not count.')

CRITERIA = {
    'VIOLATED': 'at least one changed absolute-constraint block softens the constraint it states',
    'SATISFIED': 'every changed absolute-constraint block states its constraint absolutely; any soft '
                 'word sits in the rationale or names a precise exception',
    'NOT_APPLICABLE': 'the change adds or edits no Iron Law, EXTREMELY-IMPORTANT block or absolute rule',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('changed_absolute_constraint_blocks',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'

MARKER = re.compile(r'iron law|EXTREMELY-IMPORTANT|\*\*(NEVER|ALWAYS|NO [A-Z]+[^*]* WITHOUT)\b|'
                    r'^\s*(NEVER|ALWAYS)\b|not negotiable', re.I)
SOFT = re.compile(r'\b(should|try to|consider|prefer(ably)?|ideally|where possible|if possible|'
                  r'when practical|generally|may want|might want|it is best|recommended|aim to)\b', re.I)


def evidence(files, plan_lines=None, changed=None):
    laws, examined, n_lines = [], [], 0
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
            hit = [r for r in b if MARKER.search(r[1])]
            if not hit or not any(r[0] in touched for r in b):
                continue
            text = ' '.join(t.strip() for _, t, _ in b[:8])
            laws.append({'file': rel, 'line': hit[0][0], 'section': b[0][2], 'block': clip(text, 900),
                         'soft_words': sorted({m.group(0).lower() for m in SOFT.finditer(text)})})
    laws.sort(key=lambda x: (not x['soft_words'], x['file'], x['line']))
    inventory = {
        'files_examined': examined,
        'changed_absolute_constraint_blocks': laws[:MAX_ITEMS],
        'n_changed_absolute_constraint_blocks': len(laws),
        'n_lines_searched': n_lines,
        'n_with_soft_words': sum(1 for x in laws if x['soft_words']),
    }
    return render_json('A-SOFT', [(r, a) for r, a in files if r.endswith('.md') and kind(r) != 'planning'], inventory, [])
