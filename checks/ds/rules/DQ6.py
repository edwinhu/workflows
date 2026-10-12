"""DQ6: every row-changing transform shows its row count before AND after. Calibrated 2026-10-02, two runs: vio2 0.93-0.95, sat2 0.02, real 32_agk2019 0.02; diff-scoped 2026-10-02: four legacy-base pairs, new unlogged hunk 0.98-0.99, new logged hunk <=0.01."""
from _common import render_json
from _ds import MAX_ITEMS, in_scope, is_py, parse, py_files, sources, transform_sites

PROPOSITION = ('Verification is not output-first: at least one row-changing transform (filter, join, merge, '
               'dedupe, dropna, groupby, concat) lacks a Before/After record, meaning the row count or shape '
               'of its INPUT frame is not shown next to it, or that of its OUTPUT frame is not shown after it. '
               'In the state, that is a transform site with before_and_after_shown false.')

CRITERIA = {
    'VIOLATED': 'some row-changing transform lacks either the input-side or the output-side count',
    'SATISFIED': 'every row-changing transform shows both the input count and the output count',
    'NOT_APPLICABLE': 'the files perform no row-changing transform of a data frame',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('transform_sites',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'


def evidence(files, plan_lines=None, changed=None):
    sites = [s for rel, lines in sources(files) if is_py(rel) for s in transform_sites(rel, lines)]
    n_lines = sum(len(lines) for rel, lines in sources(files) if is_py(rel) and parse(lines) is not None)
    sites, skipped = in_scope(sites, changed)
    sites = [{k: v for k, v in s.items() if k != 'end_line'} for s in sites]
    sites.sort(key=lambda s: s['before_and_after_shown'])
    inventory = {
        'transform_sites_note': ('a site is an assignment whose method chain changes the row count; a '
                                 'count line names the frame with .height, len(), .shape or a count/log '
                                 'helper; input = the source frame within 6 lines before (or after, when '
                                 'the result gets a new name), output = the assigned frame within 6 lines after'),
        'transform_sites': sites[:MAX_ITEMS],
        'n_transform_sites': len(sites),
        'n_lines_searched': n_lines,
        'n_transforms_without_before_and_after': sum(not s['before_and_after_shown'] for s in sites),
    }
    if changed is not None:
        inventory['n_transforms_considered'] = len(sites)
        inventory['n_transforms_skipped_unchanged'] = skipped
        inventory['diff_scope_note'] = ('only transforms on lines the round added or changed are listed; '
                                        'unchanged ones are out of scope, counted in n_transforms_skipped_unchanged '
                                        'and never a violation')
    return render_json('DQ6', py_files(files), inventory, [])
