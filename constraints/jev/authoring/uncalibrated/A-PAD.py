"""UNCALIBRATED -- not wired. Calibration 2026-10-02: live Jev scored the accepted State Files section of
.claude/CLAUDE.md (@0efa89be, dated Facts rows under an Iron Law) 0.67/0.68, then 0.64/0.66 with the file's
rules added to the state (wiring needs < 0.5); its violating and other compliant cases passed.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _authoring

import re

from _common import _read, render_json
from _authoring import (SUBJECT, DELIVERABLE, MAX_ITEMS, CONTEXT_LOADED, kind, changed_set, body,  # noqa: F401
                        blocks, clip)

PROPOSITION = ('A passage the change adds to a context-loaded file (SKILL.md, agent .md, command, '
               'CLAUDE.md, rules) narrates history or rationale -- how a rule came about, what used '
               'to break, who changed what when, a changelog or a story -- and neither states a rule '
               'or action nor carries a non-derivable fact (a number, threshold, tool quirk or named '
               'incident) that a rule in the file rests on.')

CRITERIA = {
    'VIOLATED': 'at least one added passage is narrative, history or backstory that changes no action '
                'and is not the measured evidence behind a stated rule',
    'SATISFIED': 'every added passage states a rule, an action, or a non-derivable fact a rule rests on; '
                 'provenance attached to a live rule counts as evidence, not padding',
    'NOT_APPLICABLE': 'the change adds no prose to a context-loaded file',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

HISTORY = re.compile(
    r'\b(used to|previously|originally|at first|initially|over time|was (added|introduced|changed|'
    r'renamed|removed|moved)|we (found|spent|tried|decided|learned|realized)|this session|back then|'
    r'historically|the story|changelog|in (january|february|march|april|may|june|july|august|'
    r'september|october|november|december)|20\d\d-\d\d-\d\d|v\d+\.\d+)', re.I)
RULE = re.compile(r'\b(never|always|must|do not|don\'t|run|use|refuse[sd]?|only|exit \d|STOP|IRON LAW)\b', re.I)
NUMBER = re.compile(r'\d')
LAW = re.compile(r'IRON LAW|^\s*\*\*[^*]{8,}\*\*|^\s*\d+\.\s+\*\*|^\s*\|\s*(About to|Add|Merge|Write|Save|Count)\b')


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
        # the rules the file states, so a dated fact can be read against the rule it rests on
        laws += [{'file': rel, 'line': n, 'text': clip(t, 200)} for n, t, _ in all_rows if LAW.search(t)]
        rows = [r for r in all_rows if r[0] in touched]
        n_added += sum(1 for r in rows if r[1].strip())
        for b in blocks(rows):
            text = ' '.join(t.strip() for _, t, _ in b)
            if text.startswith('#') and len(b) == 1:
                continue
            passages.append({'file': rel, 'line': b[0][0], 'section': b[0][2], 'text': clip(text, 700),
                             'history_markers': sorted({m.group(0).lower() for m in HISTORY.finditer(text)}),
                             'states_a_rule_or_action': bool(RULE.search(text)),
                             'carries_a_number': bool(NUMBER.search(text))})
    # history-marked passages first: those are the ones the proposition is about
    passages.sort(key=lambda p: (not p['history_markers'], p['file'], p['line']))
    inventory = {
        'files_examined': examined,
        'rules_the_files_state': laws[:12],
        'added_passages': passages[:MAX_ITEMS],
        'n_added_passages': len(passages),
        'n_with_history_markers': sum(1 for p in passages if p['history_markers']),
        'n_added_nonblank_lines': n_added,
    }
    return render_json('A-PAD', files, inventory, [])
