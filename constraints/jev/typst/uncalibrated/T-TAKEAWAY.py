"""UNCALIBRATED -- not wired. Calibration 2026-10-02, four two-run invocations: vio 0.95-0.97 and sat 0.01-0.02 throughout, but the accepted colloquium decks sat at the bar: charter deck 0.48/0.49, 0.47/0.61, 0.49/0.54, 0.46/0.47 over four invocations, Tornetta-short deck 0.44/0.47, 0.53/0.41, 0.44/0.48, 0.46/0.44; the last pair passing after two failing rounds is noise at the bar, not calibration. Those decks mix takeaway and label subtitles ("Mathematical control, effective control, four indicia."), which title-register.md allows as a house register and heading-semantics.md does not. Diff-scoped recalibration 2026-10-02 (decks as legacy bases), two two-run rounds: vio 0.96-0.97, sat <= 0.02, new takeaway subtitles 0.00-0.01, but new label subtitles fail: charter base "The 2025 amendments to Section 144." 0.43/0.53, 0.38/0.40; Tornetta base "Tesla's board and the Grant process." 0.77/0.74, 0.63/0.73.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, clip, in_changed, kind_note, scope_note, slides, typ_files

PROPOSITION = ('A slide subtitle is a topic label rather than a takeaway: at least one `===` subtitle names '
               'what the slide is about (a noun phrase such as "Proxy Advisors Overview", "Background", '
               '"Policy considerations", a case name with nothing asserted) instead of stating, in a '
               'sentence, the claim the slide supports. Read aloud as the answer to "so what?", a label '
               'only says "this slide is about X". "Discussion Questions X of N" subtitles are exempt.')

CRITERIA = {
    'VIOLATED': 'at least one listed subtitle is a topic label that asserts nothing',
    'SATISFIED': 'every listed subtitle states a claim (a takeaway sentence), however short',
    'NOT_APPLICABLE': 'the state lists no slide subtitle',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}


def evidence(files, plan_lines=None, changed=None):
    subs, skipped, exempt = [], 0, 0
    for rel, a in typ_files(files, 'deck'):
        lines = _read(a)
        if lines is None:
            continue
        for s in slides(lines):
            if DQ_TITLE.match(s['title']):
                exempt += 1
                continue
            if not in_changed(changed, rel, s['line']):
                skipped += 1
                continue
            subs.append({'file': rel, 'line': s['line'], 'subtitle': clip(s['title']),
                         'first_body_lines': [clip(t, 160) for _, t in s['body'][:2]]})
    inventory = {
        **kind_note(files, 'deck'),
        'subtitles': subs[:MAX_ITEMS],
        'n_subtitles': len(subs),
        'n_discussion_question_subtitles_exempt': exempt,
        **scope_note(changed, skipped),
    }
    return render_json('T-TAKEAWAY', files, inventory, [])
