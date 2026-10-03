"""T-HOLLOW: a notes bullet announces content the notes never write out. Calibrated 2026-10-02 after the sibling-bullet extractor, two consecutive two-run rounds: vio 0.91-0.93, sat 0.03-0.05, real colloquium charter questions/close and secreg 17-10b5 damages 0.05-0.13."""
import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, bullets, heading, in_changed, kind_note, scope_note, typ_files

PROPOSITION = ('A speaker-notes bullet is hollow: it promises content the notes never write out, so the '
               'presenter must improvise it at the podium ("let\'s walk through the scenarios", "there are '
               'six hypotheticals here", "the paper discusses several factors", "consider the following '
               'examples") and the bullets after it do not supply the scenarios, factors or examples it '
               'points to. A preview followed by the promised items, each written out, is not hollow.')

CRITERIA = {
    'VIOLATED': 'at least one listed bullet points to content that the following bullets do not supply',
    'SATISFIED': 'every listed bullet is followed by the content it announces, or announces nothing',
    'NOT_APPLICABLE': 'the state lists no announcing bullet',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('announcing_bullets',)

ITEMS = r'(?:scenarios|hypotheticals|examples|factors|points|reasons|issues|cases|steps|questions|ways)'
NUM = r'(?:two|three|four|five|six|seven|eight|nine|ten|several|a few|many|various|a number of)'
# digits only after "there are": "a 22 points gap" is a measurement, not an announcement
CUE = re.compile(r"\b(?:walk(?:ing)? (?:you )?through|go(?:ing)? through|run through|let'?s (?:look|turn|see|consider)|"
                 r'consider the following|the following|as follows|here are|there are (?:' + NUM + r'|\d+)|'
                 + NUM + r' ' + ITEMS + r'|'
                 r'discuss(?:es)? (?:several|various|a number of|some)|several (?:factors|reasons|ways))\b',
                 re.IGNORECASE)


COUNT = {'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10}


def evidence(files, plan_lines=None, changed=None):
    cands, n_bullets, skipped = [], 0, 0
    for rel, a in typ_files(files, 'notes'):
        lines = _read(a)
        if lines is None:
            continue
        heads = [i + 1 for i, t in enumerate(lines) if heading(t)]
        bl = bullets(lines)
        n_bullets += len(bl)
        for k, (n, ind, t) in enumerate(bl):
            m = CUE.search(t)
            if not m:
                continue
            if not in_changed(changed, rel, n):
                skipped += 1
                continue
            # the presenter's turn ends at the next heading: content after it is another slide's.
            # Sibling bullets are the items; a deeper sub-bullet is a detail of the item above it.
            end = next((h for h in heads if h > n), len(lines) + 1)
            after = [(bn, bt) for bn, bi, bt in bl[k + 1:] if bn < end and bi <= ind]
            num = re.search(r'\b(' + '|'.join(COUNT) + r')\s+(?:\w+\s+){0,2}' + ITEMS, t, re.IGNORECASE)
            cands.append({'file': rel, 'line': n, 'bullet': t, 'announcing_phrase': m.group(0),
                          'items_promised': COUNT[num.group(1).lower()] if num else None,
                          'n_sibling_bullets_after_it_before_the_next_heading': len(after),
                          'following_bullets': [{'line': bn, 'text': bt[:220]} for bn, bt in after[:10]]})
    inventory = {
        **kind_note(files, 'notes'),
        'announcing_bullets': cands[:MAX_ITEMS],
        'n_announcing_bullets': len(cands),
        'n_notes_bullets': n_bullets,
        **scope_note(changed, skipped),
    }
    return render_json('T-HOLLOW', files, inventory, [])
