"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: run 1 vio 0.75/0.78, real 0.60-0.65; with the rule's own GOOD examples (bare signposts) in the question vio 0.97/0.98 and Texas notes 0.20/0.35, but the accepted charter notes stayed at 0.74/0.76 ("Start with Weinberger v. UOP ..."). Diff-scoped recalibration 2026-10-02 (charter notes as legacy base), two two-run rounds: vio 0.97-0.98, sat <= 0.03, Texas notes 0.26-0.45, new cold sections 0.89-0.97, new charter section opening with a turn 0.14-0.19, but a new Texas section opening "Standing is the first gate. The second is the books-and-records demand ..." scored 0.94/0.91, 0.93/0.91. Narrowed state 2026-10-02 (with diff info only the added section opening and the previous section's last bullet), two two-run rounds: that Texas section 0.91/0.88, 0.88/0.85; everything else passes. Turn-cue state 2026-10-02 (closed-list `turn_cues`, `asks_question`, `names_previous_section`; first bullet only; the previous section's last bullet only when no cue fires), two two-run rounds: the Texas "Standing is the first gate. The second is ..." opening 0.01-0.02 (was 0.85-0.94), vio 0.93-0.95, legacy bad 0.90-0.96, Texas notes 0.03-0.05, held-out full Texas notes 0.24-0.37, a cue-free link to the previous section's last bullet (texas/ok3) 0.07-0.08; but texas/ok2, a cue-free link back to standing two sections earlier, 0.83/0.81, 0.83/0.84 -- the rule's letter counts a link to what was JUST covered, so ok2 needs the user's ruling. Every other case meets violating >= 0.90 and compliant < 0.40 in both rounds.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, added_state, clip, in_changed, kind_note, scope_note, sections, typ_files

PROPOSITION = ('A speaker-notes section opens cold: at least one listed `==` section\'s first bullet launches '
               'straight into its content -- "Several studies have examined ...", "Section 21D(f) fundamentally '
               'changed ..." -- with no spoken turn into the new topic. A turn is any sentence in the first bullet '
               'that tells the room the talk is moving on: a link to what was just covered, a question that opens '
               'the topic, or a plain signpost ("Next we look at standing", "The second is ..."). The extractor '
               'has already found the turns a closed list can see: `turn_cues` lists the signpost words the first '
               'bullet carries, `asks_question` says whether it asks, and `names_previous_section` lists the words '
               'of the previous section\'s heading it repeats. A section with any of those turns is never cold, '
               'whatever its topic. A section with none of them carries `previous_section_last_bullet`; it is '
               'still not cold when its first sentence points back at that bullet ("Those limits ...", "That '
               'is the court; ..."). In the state, a cold section has turn_cues empty, asks_question false and '
               'names_previous_section empty, and its first_bullet text opens on the new content without '
               'pointing back at previous_section_last_bullet.')

CRITERIA = {
    'VIOLATED': 'at least one listed section has no turn cue, no question and no echo of the previous heading, and its first bullet starts on the content',
    'SATISFIED': 'every listed section\'s first bullet turns the talk to its topic: a turn cue, a question, an echo of the previous heading, or a turn the closed list missed',
    'NOT_APPLICABLE': 'the state lists no section that needs a transition',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

RECAP = re.compile(r'\b(recap|review|introduction|overview)\b', re.IGNORECASE)
# Closed lists: the spoken markers that turn a talk to a new topic. The judge reads the matches, never
# re-derives them, and the first bullet alone -- the rule's turn lives there, and the bullets after it
# and the previous section's last line only lent the judge content to argue a non-sequitur from.
OPENER = re.compile(r"^\W*(so|now|next|okay|ok|alright|all right|great|but|well|then|again|finally|before|"
                    r"we move|we turn|we now|turning|moving|speaking of|today)\b", re.IGNORECASE)
SIGNPOST = re.compile(r"\b(turn to|turn now|move on|move now|moving on|next|final topic|last topic|one more|"
                      r"one final|another|let us|let's|let me|takes us|brings us|our last|the second|the third|"
                      r"the last|the final|we have (?:covered|seen|talked)|we've (?:covered|seen|talked)|so far|"
                      r"back to)\b",
                      re.IGNORECASE)
STOP = {'the', 'and', 'for', 'from', 'with', 'one', 'two', 'its', 'how', 'what', 'why', 'who', 'into', 'this',
        'that', 'over', 'under', 'part'}


def turn_facts(first, prev_heading):
    """Closed-list facts about one section's first bullet: the cues it carries, whether it asks, and the
    words of the previous `==` heading it names."""
    words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", prev_heading or '')} - STOP
    named = sorted({w for w in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", first) if w.lower() in words})
    cues = ([m.group(1) for m in [OPENER.match(first)] if m] +
            [m.group(1) for m in SIGNPOST.finditer(first)])
    return {'turn_cues': list(dict.fromkeys(c.lower() for c in cues)), 'asks_question': '?' in first,
            'names_previous_section': named}


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
                    first = clip(top[0][2])
                    facts = turn_facts(first, prev['heading'])
                    item = {'file': rel, 'line': s['line'], 'section': clip(s['heading'], 160),
                            'previous_section': clip(prev['heading'], 160),
                            'first_bullet': {'line': first_n, 'text': first}, **facts}
                    if not (facts['turn_cues'] or facts['asks_question'] or facts['names_previous_section']):
                        # a cue-free opening can still link to what was just covered; show what that was
                        ptop = [b for b in prev['bullets'] if b[1] == 0] or prev['bullets']
                        item['previous_section_last_bullet'] = clip(ptop[-1][2])
                    out.append(item)
                else:
                    skipped += 1
            if s['bullets']:
                prev = s
    if changed is not None:
        return added_state('T-TRANSITION', files, 'added_sections', out)
    inventory = {
        **kind_note(files, 'notes'),
        'sections_after_the_first': out[:MAX_ITEMS],
        'n_sections_listed': len(out),
        **scope_note(changed, skipped),
    }
    return render_json('T-TRANSITION', files, inventory, [])
