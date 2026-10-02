"""UNCALIBRATED -- not wired. Calibration 2026-10-02: margin +0.43 but violating only 0.61. The extractor drops its writes_a_declared_path / writes_a_literal_scratch_path flags.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import re
from _common import _search, _hits, render_json

PROPOSITION = 'The state writes its result somewhere the approved plan did NOT declare, so a deliverable the plan names is not produced where the plan says.'

CRITERIA = {
    'VIOLATED': 'a write goes to an undeclared path (scratch/tmp), not the declared deliverable',
    'SATISFIED': 'every write goes to the path the plan declares',
    'NOT_APPLICABLE': 'the state writes no deliverable',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    w = _search(files, r'write_csv|to_csv\(|write_parquet|write_text|savefig|open\(.*[\'"]w',
                'every path this code WRITES', window=1)
    written = []
    for pf in w['per_file']:
        for m in pf.get('matches', []):
            t = m['text']
            written.append({'file': pf['file'], 'line': m['line'], 'statement': t,
                            'writes_a_declared_path': bool(re.search(
                                r'config\.[A-Z_]+|OUT_CSV|[A-Z_]{3,}_PATH', t)),
                            'writes_a_literal_scratch_path': bool(re.search(
                                r'scratch/|/tmp/|tmp_', t))})
    plan = None
    if plan_lines:
        plan = _search([('APPROVED_PLAN', None)], '', '')  # placeholder, replaced below
        hs = _hits(plan_lines, r'deliverable|declared output|data/output|criteri|success|must')
        plan = {'what': "the approved plan's declared outputs and criteria",
                'pattern': 'deliverable|declared output|data/output|criteria|success|must',
                'files': ['APPROVED_PLAN'], 'lines_searched': len(plan_lines),
                'total_matches': len(hs),
                'per_file': [{'file': 'APPROVED_PLAN', 'readable': True,
                              'n_lines': len(plan_lines), 'n_matches': len(hs),
                              'matches': [{'line': n, 'text': t.strip()[:300]}
                                          for n, t in hs[:40]]}]}
    
    inventory = {
        'writes': [{'file': x['file'], 'line': x['line'],
                    'statement': x['statement']} for x in written],
        'n_writes': len(written)
    }
    
    searches = [w] + ([plan] if plan else [])
    return render_json('M1', files, inventory, searches)
