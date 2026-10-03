"""T-STORY: a `// Storytelling:` comment lacks the visual mechanism or the insight. Each comment carries two
closed-list flags (a visual property named, an audience conclusion stated); the diagram's own labels are withheld,
since they supplied the branching a label-only comment omits (charter/bad sat at 0.84-0.89). Calibrated 2026-10-02,
two consecutive two-run rounds: vio and both legacy label-only comments >= 0.98, every compliant case <= 0.01."""
import re

from _common import _read, render_json
from _typst import DELIVERABLE, MAX_ITEMS, SUBJECT, clip, in_changed, scope_note

PROPOSITION = ('A `// Storytelling:` comment does not carry the diagram\'s design intent: at least one names '
               'no visual mechanism (the visual property that carries meaning -- layout, branching, '
               'convergence, a gradient, colour coding, position, a timeline\'s shape) or no insight the '
               'audience should take from SEEING it, so it reads as a content label or a restatement of the '
               'data ("Shows the requirements", "Timeline of events", "Materiality decision tree"). The test: '
               'with the diagram deleted and only the comment kept, an agent could not rebuild its visual logic. '
               'Judge the comment text alone; the diagram\'s own labels never supply what the comment omits. In '
               'the state, that is a storytelling_comments entry with names_visual_property false or '
               'states_audience_conclusion false.')

CRITERIA = {
    'VIOLATED': 'some listed comment has names_visual_property false or states_audience_conclusion false: '
                'it lacks the visual mechanism or the insight it produces',
    'SATISFIED': 'every listed comment has both flags true: it names how the picture carries meaning and what '
                 'that shows',
    'NOT_APPLICABLE': 'the state lists no storytelling comment',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('storytelling_comments',)

STORY = re.compile(r'//\s*Storytelling:\s*(.*)$')
COMMENT = re.compile(r'^\s*//\s?(.*)$')
# closed lists: a visual property the picture uses, and a clause telling the audience what to conclude
VISUAL = re.compile(r'\b(layout|branch\w*|forks?|forking|converg\w*|diverg\w*|gradient|colou?r\w*|red|blue|green|'
                    r'grey|gray|orange|shaded|highlight\w*|dashed|bold|thick\w*|position\w*|above|below|beneath|'
                    r'left|right|top|bottom|upper|lower|centre|center|middle|sits?|stack\w*|column\w*|rows?|'
                    r'ladder|staircase|stairs?|steps? up|climb\w*|chain|junction|nodes?|arrows?|edges?|loop\w*|'
                    r'timeline|axis|axes|slope\w*|curve\w*|nested|size|width|height|spacing|grid|tree|path\w*|'
                    r'exit|split\w*|merges?|merging|fan\w* out|side by side|read as)\b', re.IGNORECASE)
INSIGHT = re.compile(r'→|->|\baudience\b|\b(sees?|shows?|learns?|means?) that\b|\bwhich is why\b|\bso that\b|'
                     r'\bbecause\b|\bis what makes\b|\bso the\b', re.IGNORECASE)
DIAGRAM = re.compile(r'fletcher-diagram\(|cetz\.canvas\(|lq\.diagram\(')


def _diagram(lines, j):
    """The diagram call that opens within the 12 lines after the comment: its line and kind, never its labels --
    the rule judges the comment with the diagram deleted."""
    for k in range(j, min(len(lines), j + 12)):
        if m := DIAGRAM.search(lines[k]):
            return {'line': k + 1, 'call': m.group(0).rstrip('(')}
    return None


def _flags(text):
    vis = sorted({m.group(0).lower() for m in VISUAL.finditer(text)})
    ins = sorted({m.group(0).lower() for m in INSIGHT.finditer(text)})
    return {'names_visual_property': bool(vis), 'visual_property_words': vis[:8],
            'states_audience_conclusion': bool(ins), 'conclusion_markers': ins[:8]}


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
            out.append({'file': rel, 'line': i + 1, 'comment': clip(text, 500), **_flags(text),
                        'diagram_call': _diagram(lines, j)})
    inventory = {
        'storytelling_comments': out[:MAX_ITEMS],
        'n_storytelling_comments': len(out),
        'n_comments_missing_mechanism_or_insight': sum(
            not (o['names_visual_property'] and o['states_audience_conclusion']) for o in out),
        **scope_note(changed, skipped),
    }
    return render_json('T-STORY', files, inventory, [])
