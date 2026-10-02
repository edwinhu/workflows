"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: run 1 vio 0.75/0.78, real 0.60-0.65; with the rule's own GOOD examples (bare signposts) in the question vio 0.97/0.98 and Texas notes 0.20/0.35, but the accepted charter notes stayed at 0.74/0.76 ("Start with Weinberger v. UOP ...").
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, clip, in_changed, kind_note, scope_note, sections, typ_files

PROPOSITION = ('A speaker-notes section opens cold: at least one listed `==` section launches straight into '
               'its content -- "Several studies have examined ...", "Section 21D(f) fundamentally changed ..." '
               '-- with no spoken turn into the new topic. A turn is any sentence in the first bullet that '
               'tells the room the talk is moving on: a link to what was just covered ("We have covered the '
               'theory. But what does the data say?"), a question that opens the topic ("So Texas has the '
               'code. Where do you litigate it?"), or a plain signpost ("The final topic: does Section 10(b) '
               'apply abroad?", "Next we look at standing").')

CRITERIA = {
    'VIOLATED': 'at least one listed section\'s first bullet starts the content with no turn into the topic',
    'SATISFIED': 'every listed section\'s first bullet turns the talk to its topic (a link, a question or a signpost)',
    'NOT_APPLICABLE': 'the state lists no section that needs a transition',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

RECAP = re.compile(r'\b(recap|review|introduction|overview)\b', re.IGNORECASE)


def evidence(files, plan_lines=None, changed=None):
    out, skipped = [], 0
    for rel, a in typ_files(files, 'notes'):
        lines = _read(a)
        if lines is None:
            continue
        secs = [s for s in sections(lines) if s['level'] == 2]
        prev = None
        for s in secs:
            top = [b for b in s['bullets'] if b[1] == 0] or s['bullets']
            if prev is not None and top and not RECAP.search(s['heading']):
                first_n = top[0][0]
                if in_changed(changed, rel, s['line'], top[1][0] if len(top) > 1 else first_n):
                    ptop = [b for b in prev['bullets'] if b[1] == 0] or prev['bullets']
                    out.append({'file': rel, 'line': s['line'], 'section': clip(s['heading'], 160),
                                'first_subheading': clip(s['subheads'][0][1], 160) if s['subheads'] else None,
                                'first_bullets': [{'line': n, 'text': t} for n, _, t in top[:2]],
                                'previous_section': clip(prev['heading'], 160),
                                'previous_section_last_bullet': ptop[-1][2] if ptop else None})
                else:
                    skipped += 1
            if s['bullets']:
                prev = s
    inventory = {
        **kind_note(files, 'notes'),
        'sections_after_the_first': out[:MAX_ITEMS],
        'n_sections_listed': len(out),
        **scope_note(changed, skipped),
    }
    return render_json('T-TRANSITION', files, inventory, [])
