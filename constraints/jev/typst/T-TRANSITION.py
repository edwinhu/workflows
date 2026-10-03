"""T-TRANSITION: a speaker-notes `==` section that opens cold, judged across the break alone.

USER RULING 2026-10-02 ("Don't you just need the first and last sentence across the break?"): the bridge is
the new section's first bullet against the previous section's last sentence, plus closed-list cue facts. It
must pick up, contrast with, or follow from that sentence; a link only to a non-adjacent earlier topic is not
a bridge, so texas/ok2 (back to standing, two sections earlier) was relabelled violating.

The state: `turn_cues` (opener and signpost lists), `asks_question` and `names_previous_section` on the first
bullet -- any of them clears the section. A cue-free section adds `previous_section_last_sentence` and two
break facts, `repeats_from_last_sentence` and `opens_on_pointer`, so the judge reads an explicit pickup, not a
related subject. The second and later bullets are withheld: they lent the judge content to argue a
non-sequitur from (texas/ok sat at 0.85-0.94 until the cue facts, 0.01-0.02 after).

Calibration 2026-10-02 before the ruling: four rounds, every case passing but ok2 at 0.81-0.85 as compliant.
After it, the last bullet whole and "connects" in the question: ok2 0.74/0.74 as violating and vio 0.93/0.87,
the judge taking a related subject as "follows from". With the last sentence alone, the break facts, and
"being on a related subject is not a pickup": vio 0.96, legacy bad 0.97-0.98, ok2 0.93, every compliant and
real case <= 0.10; wired by `new-rule.ts --wire` (invocations: lowest violating 0.93 and 0.90, highest
compliant 0.10 and 0.13, no cross-rule hit).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, added_state, clip, in_changed, kind_note, scope_note, sections, typ_files

PROPOSITION = ('A speaker-notes section opens cold: at least one listed `==` section\'s first bullet does not '
               'connect to the sentence that ended the previous section. The test is across the break alone. The '
               'extractor has already found the spoken turns a closed list can see: `turn_cues` lists the signpost '
               'words the first bullet carries ("Next we look at standing", "The second is ..."), `asks_question` '
               'says whether it asks, and `names_previous_section` lists the words of the previous section\'s '
               'heading it repeats. A section with any of those is never cold. A section with none of them carries '
               '`previous_section_last_sentence`, the last sentence spoken before the break, and two facts about '
               'the break: `repeats_from_last_sentence` (the words of that sentence the first bullet says again) and '
               '`opens_on_pointer` (a pointer word it opens on, "Those ...", "That is ..."). Such a section is not '
               'cold only when its first bullet explicitly picks up that last sentence -- repeats its words, points '
               'back at it, or answers it with a contrast or a consequence ("Those limits ...", "That is the court; '
               '..."). Being on a related subject is not a pickup, and neither is a link back to some earlier topic '
               'the last sentence does not mention: the room has just heard the last sentence, nothing else. In the '
               'state, a cold section has turn_cues empty, asks_question false, names_previous_section empty, '
               'repeats_from_last_sentence empty and opens_on_pointer null, and its first bullet starts on its own '
               'subject.')

CRITERIA = {
    'VIOLATED': 'at least one listed section has no turn cue, no question and no echo of the previous heading, and its first bullet does not explicitly pick up previous_section_last_sentence',
    'SATISFIED': 'every listed section has a turn cue, a question, an echo of the previous heading, or a first bullet that explicitly picks up previous_section_last_sentence',
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
        'that', 'over', 'under', 'part', 'there', 'their', 'they', 'these', 'those', 'which', 'have', 'been', 'were',
        'will', 'would', 'about', 'than', 'then', 'also', 'only', 'more', 'most', 'some', 'such', 'each', 'when',
        'where', 'does', 'did', 'can', 'may', 'all', 'any', 'not', 'but', 'our', 'your', 'very', 'even', 'just',
        'section', 'subsection'}


def turn_facts(first, prev_heading):
    """Closed-list facts about one section's first bullet: the cues it carries, whether it asks, and the
    words of the previous `==` heading it names."""
    words = {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", prev_heading or '')} - STOP
    named = sorted({w for w in re.findall(r"[A-Za-z][A-Za-z'-]{2,}", first) if w.lower() in words})
    cues = ([m.group(1) for m in [OPENER.match(first)] if m] +
            [m.group(1) for m in SIGNPOST.finditer(first)])
    return {'turn_cues': list(dict.fromkeys(c.lower() for c in cues)), 'asks_question': '?' in first,
            'names_previous_section': named}


SENTENCE_END = re.compile(r'(?<=[.!?])\s+(?=[A-Z_*"\[(])')


POINTER = re.compile(r"^\W*(this|that|these|those|such|it|they|both|either|neither|here|there)\b", re.IGNORECASE)


def _words(text):
    return {w.lower().rstrip('s') for w in re.findall(r"[A-Za-z][A-Za-z']{3,}", text)} - STOP


def break_facts(first, last):
    """Closed-list facts across the break: the words of the previous section's last sentence that the first
    bullet repeats, and the pointer word ("Those ...", "That is ...") it opens on."""
    m = POINTER.match(first)
    return {'repeats_from_last_sentence': sorted(_words(first) & _words(last)),
            'opens_on_pointer': m.group(1).lower() if m else None}


def last_sentence(text):
    """The final sentence of a bullet; an abbreviation split ("v. UOP") only shortens it to its tail."""
    parts = [p for p in SENTENCE_END.split(text.strip()) if p.strip()]
    return parts[-1] if parts else text


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
                        # a cue-free opening is judged across the break: only the sentence the room just heard
                        ptop = [b for b in prev['bullets'] if b[1] == 0] or prev['bullets']
                        last = clip(last_sentence(ptop[-1][2]))
                        item['previous_section_last_sentence'] = last
                        item.update(break_facts(first, last))
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
