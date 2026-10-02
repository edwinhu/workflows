"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: run 1 vio 0.55/0.58 (a carve-out in the question); with it removed vio 0.91/0.93, but the accepted charter notes scored 0.90 -- they say "I have linked it on the slide" and "Here is the question the slide asks" (notes 01-charter-competition.typ:164, :170) -- and Texas notes 0.52/0.59.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # _typst

import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, bullets, in_changed, kind_note, scope_note, typ_files

PROPOSITION = ('A speaker-notes bullet narrates the presentation: at least one bullet meta-references the '
               'visual on screen -- "the slide shows ...", "the diagram on this slide illustrates ...", "as '
               'you can see ...", "this table presents ...", "looking at this chart ..." -- instead of '
               'stating the content as if the slide were not there. It is narration even when the bullet '
               'goes on to say what the visual shows. Words like "table" or "shows" used about the subject '
               'matter rather than the screen ("the court\'s table of factors", "the data show") are not.')

CRITERIA = {
    'VIOLATED': 'at least one listed bullet refers to the slide, diagram, chart, table or figure on screen',
    'SATISFIED': 'no listed bullet refers to the visual on screen; each states its content directly',
    'NOT_APPLICABLE': 'the state lists no notes bullet that mentions a visual',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

CUE = re.compile(r'\b(slides?|diagrams?|charts?|tables?|figures?|graphs?|screen|pictures?|images?|plots?|'
                 r'visuals?|timeline|as you can see|you can see|look(?:ing)? at|shown|shows|illustrates?|'
                 r'presents?|depicts?|displays?)\b', re.IGNORECASE)


def evidence(files, plan_lines=None, changed=None):
    cands, n_bullets, skipped, stage = [], 0, 0, 0
    for rel, a in typ_files(files, 'notes'):
        lines = _read(a)
        if lines is None:
            continue
        bl = bullets(lines)
        n_bullets += len(bl)
        for k, (n, _, t) in enumerate(bl):
            # a bracketed bullet is a stage direction, not spoken; an [Answer ...] block is spoken
            if t.startswith('[') and not t.startswith('[Answer'):
                stage += 1
                continue
            cues = sorted({m.group(0).lower() for m in CUE.finditer(t)})
            if not cues:
                continue
            if not in_changed(changed, rel, n):
                skipped += 1
                continue
            cands.append({'file': rel, 'line': n, 'bullet': t, 'visual_cues': cues,
                          'next_bullet': bl[k + 1][2][:200] if k + 1 < len(bl) else None})
    inventory = {
        **kind_note(files, 'notes'),
        'bullets_mentioning_a_visual': cands[:MAX_ITEMS],
        'n_bullets_mentioning_a_visual': len(cands),
        'n_notes_bullets': n_bullets,
        'n_bracketed_stage_directions_not_spoken': stage,
        **scope_note(changed, skipped),
    }
    return render_json('T-NARRATE', files, inventory, [])
