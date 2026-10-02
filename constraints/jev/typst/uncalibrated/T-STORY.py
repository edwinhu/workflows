"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: vio 0.96-0.97 and sat <= 0.10, but the accepted charter-deck comment ("the controller sits above both merger parties -> the price the minority receives is set by the buyer's own agent") scored 0.49/0.54, then 0.45/0.50 with node layout extracted.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, clip, in_changed, scope_note

PROPOSITION = ('A `// Storytelling:` comment does not carry the diagram\'s design intent: at least one names '
               'no visual mechanism (the visual property that carries meaning -- layout, branching, '
               'convergence, a gradient, colour coding, position, a timeline\'s shape) or no insight the '
               'audience should take from SEEING it, so it reads as a content label or a restatement of the '
               'data ("Shows the requirements", "Timeline of events", "Materiality decision tree"). The test: '
               'with the diagram deleted and only the comment kept, an agent could not rebuild its visual logic.')

CRITERIA = {
    'VIOLATED': 'at least one listed comment lacks the visual mechanism or the insight it produces',
    'SATISFIED': 'every listed comment names both how the picture carries meaning and what that shows',
    'NOT_APPLICABLE': 'the state lists no storytelling comment',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

STORY = re.compile(r'//\s*Storytelling:\s*(.*)$')
COMMENT = re.compile(r'^\s*//\s?(.*)$')
DIAGRAM = re.compile(r'fletcher-diagram\(|cetz\.canvas\(|lq\.diagram\(')
# a fletcher node or a cetz content label: its position and its text
PLACED = re.compile(r'\b(node|content)\(\s*\(([^()]*)\)\s*,\s*\[((?:[^\[\]]|\[[^\]]*\])*)\]')


def _layout(lines, j):
    """What the diagram after line j places where: up to 12 positioned labels and the edge count,
    read from the call that opens within the next 12 lines (span bounded at 200 lines)."""
    start = next((k for k in range(j, min(len(lines), j + 12)) if DIAGRAM.search(lines[k])), None)
    if start is None:
        return None
    text, depth = '', 0
    for k in range(start, min(len(lines), start + 200)):
        text += lines[k] + '\n'
        depth += lines[k].count('(') - lines[k].count(')')
        if depth <= 0 and k > start:
            break
    placed = [f'({m.group(2).strip()}) {clip(m.group(3), 60)}' for m in PLACED.finditer(text)]
    return {'line': start + 1, 'call': DIAGRAM.search(lines[start]).group(0).rstrip('('),
            'placed_labels': placed[:12], 'n_placed_labels': len(placed),
            'n_edges_or_lines': len(re.findall(r'\b(?:edge|line)\(', text))}


def evidence(files, plan_lines=None, changed=None):
    out, skipped = [], 0
    for rel, a in files:
        if not rel.lower().endswith('.typ'):
            continue
        lines = _read(a)
        if lines is None:
            continue
        for i, t in enumerate(lines):
            m = STORY.search(t)
            if not m:
                continue
            text, j = m.group(1).strip(), i + 1
            while j < len(lines) and (c := COMMENT.match(lines[j])) and not STORY.search(lines[j]):
                text += ' ' + c.group(1).strip()
                j += 1
            if not in_changed(changed, rel, i + 1, j + 1):
                skipped += 1
                continue
            out.append({'file': rel, 'line': i + 1, 'comment': clip(text, 500),
                        'has_arrow_separator': bool(re.search(r'→|->', text)),
                        'diagram': _layout(lines, j)})
    inventory = {
        'storytelling_comments': out[:MAX_ITEMS],
        'n_storytelling_comments': len(out),
        **scope_note(changed, skipped),
    }
    return render_json('T-STORY', files, inventory, [])
