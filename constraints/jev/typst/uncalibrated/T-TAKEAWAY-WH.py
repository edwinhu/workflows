"""UNCALIBRATED -- not wired. Split from T-TAKEAWAY 2026-10-02: a wh-opening subtitle without `?` is either an
embedded question used as a label ("Why Nevada narrowed the controller test.") or a sentence whose subject is the
wh-clause ("What AB 239 left out was Delaware's stockholder-vote route."); no flag separates them (accepted decks
hold ~20 of the first and ~12 of the second). Calibration 2026-10-02, two two-run rounds, body withheld:
"no main verb after the clause" wording: vio 0.27/0.31, Nevada wh label 0.31/0.30; "fits 'This slide explains
___'" frame, three invocations: vio 0.49-0.65, Nevada wh label 0.85-0.89; the wh-subject sentences 0.03-0.08. Jev reads
the clause's presupposition as an assertion. Kept here, below the glob rule-check.ts reads, until a parser fact
(is a finite verb outside the wh-clause) or a firmer question earns it back; the lens keeps these subtitles.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, added_state, clip, in_changed, kind_note, scope_note, slides, typ_files, wh_fragment

PROPOSITION = ('At least one listed `===` subtitle is an embedded question used as a label. The test: drop its '
               'final punctuation and put it in the frame "This slide explains ___." A label fits the frame '
               'as a grammatical sentence ("This slide explains why the SEC narrowed the exemption", "... '
               'explains what a poison pill costs"); a sentence whose subject is the wh-clause does not fit, '
               'because its main verb follows the clause ("What the SEC narrowed was the private-offering '
               'exemption", "Who counts as an insider turns on the relationship" cannot follow "explains"). '
               'Judge the subtitle text alone.')

CRITERIA = {
    'VIOLATED': 'at least one listed subtitle fits "This slide explains ___" as a grammatical sentence',
    'SATISFIED': 'no listed subtitle fits the frame: each wh-clause is the subject of a main verb after it',
    'NOT_APPLICABLE': 'the state lists no subtitle',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}


def evidence(files, plan_lines=None, changed=None):
    subs, skipped = [], 0
    for rel, a in typ_files(files, 'deck'):
        lines = _read(a)
        if lines is None:
            continue
        for s in slides(lines):
            if DQ_TITLE.match(s['title']) or not wh_fragment(s['title']):
                continue
            if not in_changed(changed, rel, s['line']):
                skipped += 1
                continue
            # The body is withheld, as in T-TAKEAWAY: it states the answer a label subtitle omits.
            subs.append({'file': rel, 'line': s['line'], 'subtitle': clip(s['title'].strip())})
    if changed is not None:
        return added_state('T-TAKEAWAY-WH', files, 'added_wh_subtitles', subs)
    inventory = {
        **kind_note(files, 'deck'),
        'wh_subtitles': subs[:MAX_ITEMS],
        'n_wh_subtitles': len(subs),
        **scope_note(changed, skipped),
    }
    return render_json('T-TAKEAWAY-WH', files, inventory, [])
