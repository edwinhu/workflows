import re

from _common import _read, render_json
from _authoring import SUBJECT, DELIVERABLE, MAX_ITEMS, kind, changed_set, frontmatter, unquote, clip  # noqa: F401

PROPOSITION = ('A changed skill, agent or command description summarizes the PROCESS -- the steps or '
               'phases the skill runs, what it does internally, in what order, or what it computes -- '
               'instead of carrying only triggers (when to use it, the phrases that invoke it) and '
               'routing (which neighbour to use instead). Naming the domain or the deliverable is a '
               'trigger, not a process summary.')

CRITERIA = {
    'VIOLATED': 'at least one changed description narrates how the skill works -- its phases, steps, '
                'internal mechanics or sequence -- beyond naming when to use it',
    'SATISFIED': 'every changed description is triggers and routing only: when to use it, invoking '
                 'phrases, what it is for, and which neighbour owns what it does not',
    'NOT_APPLICABLE': 'the change touches no skill, agent or command description',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

SENT = re.compile(r'(?<=[.;!?])\s+(?=[A-Z(\'"])')


def evidence(files, plan_lines=None, changed=None):
    descs, examined = [], []
    for rel, a in files:
        if kind(rel) not in ('skill', 'agent', 'command'):
            continue
        lines = _read(a)
        if lines is None:
            continue
        examined.append(rel)
        _, fm = frontmatter(lines)
        if 'description' not in fm:
            continue
        lo, hi, raw = fm['description']
        touched = changed_set(rel, changed, len(lines))
        if not any(n in touched for n in range(lo, hi + 1)):
            continue
        d = unquote(raw)
        name = unquote(fm['name'][2]) if 'name' in fm else None
        descs.append({'file': rel, 'line': lo, 'name': name, 'kind': kind(rel), 'chars': len(d),
                      'clauses': [clip(c, 400) for c in SENT.split(d) if c.strip()][:20]})
    inventory = {
        'files_examined': examined,
        'changed_descriptions': descs[:MAX_ITEMS],
        'n_changed_descriptions': len(descs),
    }
    return render_json('A-DESC', files, inventory, [])
