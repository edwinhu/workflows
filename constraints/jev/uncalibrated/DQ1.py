"""UNCALIBRATED -- not wired. Calibration 2026-10-02: margin +0.50 but violating only 0.63, and 0.58-0.73 on every other rule's fixtures: an absence of profiling reads as a violation on any file.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import re
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
