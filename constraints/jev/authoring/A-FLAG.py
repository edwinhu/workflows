import re

from _common import _read, render_json
from _authoring import SUBJECT, DELIVERABLE, MAX_ITEMS, kind, changed_set, body, clip  # noqa: F401

PROPOSITION = ('A changed red flag or STOP interrupt is triggered by an intention, thought or feeling '
               '("if you catch yourself thinking", "tempted to", "feel like", "want to", "considering") '
               'rather than by an observable action or situation the agent can detect ("About to X", '
               '"X came back CLEAN", a command about to be run, a file about to be written).')

CRITERIA = {
    'VIOLATED': 'at least one changed red flag fires on a thought, urge or intention rather than on an '
                'observable action or situation',
    'SATISFIED': 'every changed red flag names an observable action or situation as its trigger',
    'NOT_APPLICABLE': 'the change adds or edits no red flag or STOP interrupt',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

FLAG_SECTION = re.compile(r'red.?flag|\bstop\b', re.I)
FLAG_LINE = re.compile(r'\bSTOP\b|catch yourself|find yourself|notice yourself|tempted|\babout to\b|red flag', re.I)
INTENT = re.compile(r'catch yourself|find yourself|notice yourself|tempted|\bthinking\b|feel(ing)? like|'
                    r'\bwant(ing)? to\b|\bconsidering\b|\burge\b|\bwonder', re.I)
TABLE_SEP = re.compile(r'^\s*\|[\s:|-]+\|\s*$')


def evidence(files, plan_lines=None, changed=None):
    flags, examined = [], []
    for rel, a in files:
        if not rel.endswith('.md') or kind(rel) == 'planning':
            continue
        lines = _read(a)
        if lines is None:
            continue
        examined.append(rel)
        touched = changed_set(rel, changed, len(lines))
        for n, t, heading in body(lines):
            s = t.strip()
            if n not in touched or not s or TABLE_SEP.match(t) or s.startswith('#'):
                continue
            if n < len(lines) and TABLE_SEP.match(lines[n]):  # a table's header row names columns, not a flag
                continue
            if not (FLAG_SECTION.search(heading) or FLAG_LINE.search(t)):
                continue
            # a table row's first cell is its trigger
            cells = [c.strip() for c in s.strip('|').split('|')] if s.startswith('|') else None
            trigger = cells[0] if cells else s
            flags.append({'file': rel, 'line': n, 'section': heading, 'text': clip(t),
                          'trigger': clip(trigger, 200),
                          'intention_words': sorted({m.group(0).lower() for m in INTENT.finditer(trigger)})})
    flags.sort(key=lambda f: (not f['intention_words'], f['file'], f['line']))
    inventory = {
        'files_examined': examined,
        'changed_red_flags': flags[:MAX_ITEMS],
        'n_changed_red_flags': len(flags),
        'n_with_intention_words_in_trigger': sum(1 for f in flags if f['intention_words']),
    }
    return render_json('A-FLAG', files, inventory, [])
