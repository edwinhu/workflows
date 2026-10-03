"""DQ4: every row-changing transform logs its output count. Calibrated 2026-10-02, two runs: vio2 1.00, sat2 0.00, real 32_agk2019 <=0.01; diff-scoped 2026-10-02: four legacy-base pairs, new unlogged hunk 1.00, new logged hunk 0.00."""
from _common import render_json
from _ds import MAX_ITEMS, in_scope, is_py, sources, transform_sites

PROPOSITION = ('The row-count chain is BROKEN: at least one row-changing transform (filter, join, merge, '
               'dedupe, dropna, groupby, concat) assigns a frame whose resulting row count is never recorded '
               'in the lines that follow it, so a reader cannot trace input -> transform -> output. In the '
               'state, that is a transform site with output_count_shown false.')

CRITERIA = {
    'VIOLATED': 'some row-changing transform is followed by no record of the resulting row count',
    'SATISFIED': 'every row-changing transform is followed by a record of its resulting row count',
    'NOT_APPLICABLE': 'the files perform no row-changing transform of a data frame',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('transform_sites',)


def evidence(files, plan_lines=None, changed=None):
    sites = [s for rel, lines in sources(files) if is_py(rel) for s in transform_sites(rel, lines)]
    sites, skipped = in_scope(sites, changed)
    keep = ('file', 'line', 'statement', 'target', 'row_changing_methods', 'output_count_shown',
            'output_count_lines')
    sites = [{k: s[k] for k in keep} for s in sites]
    sites.sort(key=lambda s: s['output_count_shown'])
    inventory = {
        'transform_sites_note': ('a site is an assignment whose method chain changes the row count; '
                                 'output_count_shown = the assigned name appears with .height, len(), '
                                 '.shape or a count/log helper within the 6 lines after it'),
        'transform_sites': sites[:MAX_ITEMS],
        'n_transform_sites': len(sites),
        'n_transforms_without_output_count': sum(not s['output_count_shown'] for s in sites),
    }
    if changed is not None:
        inventory['n_transforms_considered'] = len(sites)
        inventory['n_transforms_skipped_unchanged'] = skipped
        inventory['diff_scope_note'] = ('only transforms on lines the round added or changed are listed; '
                                        'unchanged ones are out of scope, counted in n_transforms_skipped_unchanged '
                                        'and never a violation')
    return render_json('DQ4', files, inventory, [])
