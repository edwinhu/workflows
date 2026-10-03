import re

from _common import _read, render_json
from _authoring import (SUBJECT, DELIVERABLE, MAX_ITEMS, CONTEXT_LOADED, kind, changed_set, body,  # noqa: F401
                        blocks, clip)

PROPOSITION = ('A passage the change adds to a context-loaded file (SKILL.md, agent .md, command, '
               'CLAUDE.md, rules) is padding: it narrates history or rationale -- how a rule came about, '
               'what used to break ("this used to be broken because..."), who changed what when, a '
               'changelog or a story, or a restatement of a rationale already given -- and neither states '
               'a rule or action nor is a fact row. A fact row is a line, list item or table row that '
               'carries a number, threshold, measurement, date or named incident (a file:line, commit, '
               'named file or tool quirk) and backs a rule stated in the file; fact rows are sanctioned '
               'evidence, never padding, however past-tense or dated their wording.')

CRITERIA = {
    'VIOLATED': 'at least one added passage is narrative, history, backstory or restated rationale that '
                'changes no action and is not a fact row',
    'SATISFIED': 'every added passage states a rule or an action, or is a fact row: a number, threshold, '
                 'measurement, date or named incident backing a rule the file states',
    'NOT_APPLICABLE': 'the change adds no prose to a context-loaded file',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('added_passages',)

HISTORY = re.compile(
    r'\b(used to|previously|originally|at first|initially|over time|was (added|introduced|changed|'
    r'renamed|removed|moved)|we (found|spent|tried|decided|learned|realized)|this session|back then|'
    r'historically|the story|changelog|in (january|february|march|april|may|june|july|august|'
    r'september|october|november|december)|20\d\d-\d\d-\d\d|v\d+\.\d+)', re.I)
RULE = re.compile(r'\b(never|always|must|do not|don\'t|run|use|refuse[sd]?|only|exit \d|STOP|IRON LAW)\b', re.I)
NUMBER = re.compile(r'\d')
# a named incident: a file:line, a commit, a dated event, a named file or an identifier in backticks
INCIDENT = re.compile(r'[\w./-]+\.\w+:\d+|\b[0-9a-f]{7,40}\b|20\d\d-\d\d-\d\d|`[^`]*[\w./-]+\.(json|md|ts|py|sh|js|tsv)`')
LAW = re.compile(r'IRON LAW|^\s*\*\*[^*]{8,}\*\*|^\s*\d+\.\s+\*\*|^\s*\|\s*(About to|Add|Merge|Write|Save|Count)\b')
ITEM = re.compile(r'^\s*([-*+]|\d+\.)\s+')
CHAPTER = re.compile(r'^#{1,2}\s')
NEAR = 40  # a fact row backs a rule stated within this many lines in the same top-level section


def units(block):
    """A block split at list items, so each fact row is read alone; continuation lines join the item
    above them. A table stays one unit: its header is what makes each row a rule."""
    if block[0][1].lstrip().startswith('|'):
        return [block]
    out = []
    for r in block:
        if not out or ITEM.match(r[1]):
            out.append([r])
        else:
            out[-1].append(r)
    return out


def chapters(lines):
    """Per 1-based line, the line number of the nearest # or ## heading above it (0 for none)."""
    out, cur = [0], 0
    for i, t in enumerate(lines, 1):
        if CHAPTER.match(t):
            cur = i
        out.append(cur)
    return out


def evidence(files, plan_lines=None, changed=None):
    passages, examined, laws, n_added = [], [], [], 0
    for rel, a in files:
        if kind(rel) not in CONTEXT_LOADED:
            continue
        lines = _read(a)
        if lines is None:
            continue
        examined.append(rel)
        touched = changed_set(rel, changed, len(lines))
        all_rows = body(lines)
        chap = chapters(lines)
        # the rules the file states, so a dated fact can be read against the rule it rests on
        file_laws = [(n, t) for n, t, _ in all_rows if LAW.search(t)]
        laws += [{'file': rel, 'line': n, 'text': clip(t, 200)} for n, t in file_laws]
        rows = [r for r in all_rows if r[0] in touched]
        n_added += sum(1 for r in rows if r[1].strip())
        for b in blocks(rows):
            for u in units(b):
                text = ' '.join(t.strip() for _, t, _ in u)
                if text.startswith('#') and len(u) == 1:
                    continue
                first, last = u[0][0], u[-1][0]
                own = next(((n, t) for n, t, _ in u if LAW.search(t)), None)
                near = [(n, t) for n, t in file_laws if chap[n] == chap[first]
                        and (n < first and first - n <= NEAR or n > last and n - last <= NEAR)]
                backs = own or (min(near, key=lambda x: abs(x[0] - first)) if near else None)
                has_fact = bool(NUMBER.search(text) or INCIDENT.search(text))
                passages.append({'file': rel, 'line': first, 'section': u[0][2], 'text': clip(text, 500),
                                 'history_markers': sorted({m.group(0).lower() for m in HISTORY.finditer(text)}),
                                 'states_a_rule_or_action': bool(RULE.search(text) or own),
                                 'carries_a_number': bool(NUMBER.search(text)),
                                 'names_an_incident': bool(INCIDENT.search(text)),
                                 'backs_rule': {'line': backs[0], 'text': clip(backs[1], 160)} if backs else None,
                                 'fact_row': bool(has_fact and backs)})
    # history-marked passages that are not fact rows first: those are the ones the proposition is about
    passages.sort(key=lambda p: (not (p['history_markers'] and not p['fact_row']), p['fact_row'],
                                 p['file'], p['line']))
    inventory = {
        'files_examined': examined,
        'rules_the_files_state': laws[:12],
        'added_passages': passages[:MAX_ITEMS],
        'n_added_passages': len(passages),
        'n_fact_rows': sum(1 for p in passages if p['fact_row']),
        'n_with_history_markers': sum(1 for p in passages if p['history_markers']),
        'n_history_marked_not_fact_rows': sum(1 for p in passages if p['history_markers'] and not p['fact_row']),
        'n_added_nonblank_lines': n_added,
    }
    return render_json('A-PAD', files, inventory, [])
