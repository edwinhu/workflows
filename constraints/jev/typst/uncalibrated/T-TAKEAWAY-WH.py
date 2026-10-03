"""UNCALIBRATED -- not wired. Split from T-TAKEAWAY 2026-10-02: a wh-opening subtitle without `?` is either an
embedded question used as a label ("Why Nevada narrowed the controller test.") or a sentence whose subject is the
wh-clause ("What AB 239 left out was Delaware's stockholder-vote route."). Not scriptable: a closed-class lexicon and
a spaCy sm parse each decided all 25 set and colloquium subtitles but called 3 of 10 held-out sentences labels.
Each subtitle carries `framed` ("This slide explains <subtitle>."), so the judge rules on grammaticality instead of
building the frame: vio rose from 0.27-0.65 (earlier wordings, subtitle alone) to 0.80-0.88. Calibration
2026-10-02, two-run invocations, final code (claim-first wording, subtitle and `framed` shown): vio 0.86/0.88,
0.86/0.81, 0.85/0.86, whole-set run 0.85/0.86; Nevada wh label 0.95-0.97; held-out label "How AB 239 changed ..." 0.94-0.95; every compliant
case <= 0.17. A third wording (a what-as-subject example) took vio to 0.81/0.79; withholding the bare subtitle took
it to 0.78-0.81 and the compliant cases to 0.29. The twin's what-as-subject label ("What made proxy advisors
powerful.") sits at the bar, short of the 0.90 margin. Keep parked: the real cases separate (0.94-0.97 against
<= 0.17), so a firmer fact for what-as-subject labels could earn it back; meanwhile the lens keeps these subtitles.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

from _common import _read, render_json
from _typst import DELIVERABLE, DQ_TITLE, MAX_ITEMS, SUBJECT, added_state, clip, in_changed, kind_note, scope_note, slides, typ_files, wh_fragment

PROPOSITION = ('At least one listed `framed` string is a grammatical English sentence. `framed` is the '
               'subtitle with its final punctuation dropped, placed after "This slide explains". A bare '
               'wh-clause makes a grammatical sentence there ("This slide explains why the SEC narrowed the '
               'exemption.", "This slide explains how courts read the statute."), and a subtitle that does so is '
               'an embedded question used as a label. A wh-clause that is the subject of a main verb after it '
               'does not: two finite verbs then stand where one clause fits ("This slide explains what the SEC '
               'narrowed was the private-offering exemption.", "This slide explains who counts as an insider '
               'depends on the relationship."). Judge each `framed` string alone; ignore style and register.')

CRITERIA = {
    'VIOLATED': 'at least one listed `framed` string is a grammatical English sentence',
    'SATISFIED': 'every listed `framed` string is ungrammatical: each wh-clause is the subject of a main verb after it',
    'NOT_APPLICABLE': 'the state lists no subtitle',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}


def framed(title):
    """The subtitle as the complement of "This slide explains": grammatical for a bare wh-clause, not for a
    wh-clause that is the subject of a later main verb. Built here so the judge reads it, not constructs it."""
    t = re.sub(r'[.!;:]+$', '', re.sub(r'\s+', ' ', title).strip())
    return clip(f'This slide explains {t[:1].lower()}{t[1:]}.')


# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'


def evidence(files, plan_lines=None, changed=None):
    subs, skipped, n_lines = [], 0, 0
    for rel, a in typ_files(files, 'deck'):
        lines = _read(a)
        if lines is None:
            continue
        n_lines += len(lines)
        for s in slides(lines):
            if DQ_TITLE.match(s['title']) or not wh_fragment(s['title']):
                continue
            if not in_changed(changed, rel, s['line']):
                skipped += 1
                continue
            # The body is withheld, as in T-TAKEAWAY: it states the answer a label subtitle omits.
            t = s['title'].strip()
            subs.append({'file': rel, 'line': s['line'], 'subtitle': clip(t), 'framed': framed(t)})
    if changed is not None:
        return added_state('T-TAKEAWAY-WH', files, 'added_wh_subtitles', subs)
    inventory = {
        'n_lines_searched': n_lines,
        **kind_note(files, 'deck'),
        'wh_subtitles': subs[:MAX_ITEMS],
        'n_wh_subtitles': len(subs),
        **scope_note(changed, skipped),
    }
    return render_json('T-TAKEAWAY-WH', typ_files(files, 'deck'), inventory, [])
