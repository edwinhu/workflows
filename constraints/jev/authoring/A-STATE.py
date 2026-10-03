import os
import re

from _common import _read, render_json
from _authoring import (SUBJECT, DELIVERABLE, MAX_ITEMS, kind, changed_set, whole_file_changed,  # noqa: F401
                        root_of, clip)

PROPOSITION = ('The change introduces a NEW persistent state file or a new .planning/ document noun -- a '
               'file the change creates, or starts reading or writing, that is not one of the canonical '
               'set (.claude-workflows.json, .planning/.state/review.json, .planning/.state/episode.json, '
               '.planning/ACTIVE_WORKFLOW.md, the one generated plan, HUMAN_REVIEW.md, '
               'AUTOMATED_REVIEW.md, or a session-scoped file under the OS temp dir) -- without retiring '
               'an existing file in the same change or recording in a docs/DESIGN-*.md why its boundary '
               'is load-bearing.')

CRITERIA = {
    'VIOLATED': 'the change adds a non-canonical state file or .planning/ noun (or code that writes one) '
                'and neither deletes a file nor records a DESIGN reason for the new boundary',
    'SATISFIED': 'every state the change adds goes into a canonical file or the temp dir, or the change '
                 'retires a file or records a load-bearing reason in docs/DESIGN-*.md',
    'NOT_APPLICABLE': 'the change adds no state file, .planning/ file or state-writing code',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('added_lines_writing_or_naming_state',)

CANONICAL = {'.claude-workflows.json', 'review.json', 'episode.json', 'ACTIVE_WORKFLOW.md',
             'HUMAN_REVIEW.md', 'AUTOMATED_REVIEW.md'}
WRITES = re.compile(r'writeFileSync|appendFileSync|write_text|json\.dump\b|open\([^)]*[\'"][wa]\+?[\'"]|'
                    r'\btee\b|(?<![<>=-])>>?\s*["\']?[\w${}./-]+\.(json|md|txt|tsv|jsonl)\b')
STATE_PATH = re.compile(r'\.planning/[\w./${}<>-]*|\.state/[\w.${}<>-]+|[\w-]*_CLARIFIED\.json|'
                        r'[\w./${}-]+\.jsonl?\b')
TEMP = re.compile(r'gettempdir|tmpdir\(|\$TMPDIR|/tmp/|mkdtemp|XDG_RUNTIME_DIR', re.I)


def evidence(files, plan_lines=None, changed=None):
    planning, writers, deleted, design, root = [], [], [], [], None
    for rel, a in files:
        root = root or root_of(rel, a)
        lines = _read(a)
        if lines is None:
            if not os.path.exists(a):
                deleted.append(rel)
            continue
        if re.match(r'(.*/)?docs/DESIGN-.*\.md$', rel):
            design.append(rel)
        if kind(rel) == 'planning':
            planning.append({'file': rel, 'canonical_name': os.path.basename(rel) in CANONICAL,
                             'created_or_rewritten_whole': whole_file_changed(rel, changed, len(lines)),
                             'first_lines': [clip(t, 160) for t in lines[:3]]})
            continue
        touched = changed_set(rel, changed, len(lines))
        for n in sorted(touched):
            t = lines[n - 1]
            w = bool(WRITES.search(t))
            if not (w or '.planning/' in t or '.state/' in t or '_CLARIFIED' in t):
                continue
            writers.append({'file': rel, 'line': n, 'text': clip(t), 'writes': w,
                            'paths_named': sorted({m.group(0) for m in STATE_PATH.finditer(t)})[:6],
                            'temp_dir': bool(TEMP.search(t))})
    inv = None
    if root and os.path.isdir(os.path.join(root, '.planning')):
        p = os.path.join(root, '.planning')
        names = sorted(os.listdir(p))
        st = sorted(os.listdir(os.path.join(p, '.state'))) if os.path.isdir(os.path.join(p, '.state')) else []
        inv = {'n_entries_in_planning': len(names), 'planning_state_dir': st[:20],
               'non_canonical_planning_md': [n for n in names if n.endswith('.md') and n not in CANONICAL][:30]}
    inventory = {
        'planning_files_in_change': planning[:MAX_ITEMS],
        'added_lines_writing_or_naming_state': writers[:MAX_ITEMS],
        'n_added_lines_writing_or_naming_state': len(writers),
        'files_deleted_by_change': deleted[:MAX_ITEMS],
        'design_docs_in_change': design,
        'existing_planning_inventory': inv,
    }
    return render_json('A-STATE', files, inventory, [])
