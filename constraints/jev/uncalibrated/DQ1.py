"""UNCALIBRATED -- not wired, and not meant to be. Calibration 2026-10-02, two runs: violating 0.62-0.66, compliant 0.04-0.05, but 0.90-0.91 on DQ6/vio2 and 0.78-0.79 on real accepted files: an absence of profiling reads as a violation on any file.
Decided by a script instead: skills/ds/scripts/ds-dq.py check_dq1 (constant/empty columns on the output), run by check.sh.
"""
from _common import _search, render_json

PROPOSITION = 'The state writes or analyses a table WITHOUT any check for empty or constant (zero-information) columns.'

CRITERIA = {
    'VIOLATED': 'no empty/constant-column check is present',
    'SATISFIED': 'an empty/constant-column check is present',
    'NOT_APPLICABLE': 'the state writes or analyses no table',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    d = _search(files, r'n_unique\(\)|nunique\(\)|null_count\(\)|isnull\(\)|isna\(\)|'
                       r'value_counts\(\)|is constant|constant column|zero-information|DQ1',
                'the empty/constant/null column diagnostic', window=1)
    return render_json('DQ1', files, {}, [d])
