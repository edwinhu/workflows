"""T-TAKEAWAY: a `===` subtitle is a noun- or gerund-phrase topic label, not a takeaway sentence. The state
lists each subtitle's text alone: the slide body is withheld, since its first lines stated the claim a label
subtitle omits and answered for it (charter/bad sat at 0.38-0.46, Tornetta/bad at 0.81-0.86 over four rounds).
Withholding it took them to 0.79/0.87 and 0.95; naming "a final period does not make a noun phrase a sentence"
in the proposition took charter to 0.93-0.96. A wh-opening subtitle without `?` is deferred to T-TAKEAWAY-WH
(`wh_fragment`), since an embedded question and a wh-subject sentence share the opening and the held-out
Nevada wh label sat at 0.21-0.76 here. The gerund label sat at 0.89-0.92 until each subtitle carried
`opens_with_ing_word` (0.95-0.97); a sentence whose subject is a gerund phrase stays low (0.10-0.17). Calibrated
2026-10-02, two consecutive two-run invocations on the final code: every violating case >= 0.93, every compliant
case <= 0.17."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, added_state, clip, in_changed, kind_note, scope_note, slides, typ_files, wh_fragment

PROPOSITION = ('At least one listed `===` subtitle is a topic label, not a takeaway sentence: it has no main '
               'clause in which a subject takes a finite verb to state the claim the slide supports, so read '
               'aloud as the answer to "so what?" it only says "this slide is about X". Judge the subtitle '
               'text alone. Noun phrases ("Proxy Advisors Overview", "The registration exemptions under the '
               '1933 Act.") and gerund phrases ("Reviewing the safe harbor.") are labels whatever their final '
               'punctuation: each fits the frame "This slide is about ___", which a sentence cannot. A '
               'subtitle with opens_with_ing_word true is a gerund-phrase label unless a finite verb follows '
               'the phrase ("Voting by proxy became the norm." is a sentence). A '
               'sentence states a claim however short it is. "Discussion Questions X of N" subtitles are '
               'exempt.')

ING_OPEN = re.compile(r'^\W*[A-Za-z]{2,}ing\b')

CRITERIA = {
    'VIOLATED': 'at least one listed subtitle is a topic label that asserts nothing',
    'SATISFIED': 'every listed subtitle states a claim (a takeaway sentence), however short',
    'NOT_APPLICABLE': 'the state lists no slide subtitle',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('subtitles',)


def evidence(files, plan_lines=None, changed=None):
    subs, skipped, exempt, deferred = [], 0, 0, 0
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
            if wh_fragment(s['title']):  # T-TAKEAWAY-WH judges these alone
                deferred += 1
                continue
            # The body is withheld: its lines state the claim a label subtitle omits, and answer for it.
            t = s['title'].strip()
            subs.append({'file': rel, 'line': s['line'], 'subtitle': clip(t),
                         'opens_with_ing_word': bool(ING_OPEN.match(t))})
    if changed is not None:
        return added_state('T-TAKEAWAY', files, 'added_subtitles', subs)
    inventory = {
        **kind_note(files, 'deck'),
        'subtitles': subs[:MAX_ITEMS],
        'n_subtitles': len(subs),
        'n_discussion_question_subtitles_exempt': exempt,
        'n_wh_subtitles_judged_by_T_TAKEAWAY_WH': deferred,
        **scope_note(changed, skipped),
    }
    return render_json('T-TAKEAWAY', files, inventory, [])
