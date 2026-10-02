"""UNCALIBRATED -- not wired. Calibration 2026-10-02: margin -0.15 (inverted): violating 0.27, compliant 0.34. The state is a bag of regex hits with no fact a flow summary would change.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import re
from _common import _search, render_json

PROPOSITION = 'The row-count chain in the state is BROKEN: at least one transform does not record the input count, the output count and the rule that links them.'

CRITERIA = {
    'VIOLATED': 'a transform in the state records no input->output count',
    'SATISFIED': 'every transform records its input count, output count and the linking rule',
    'NOT_APPLICABLE': 'the state performs no transform whose row count could be traced',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    chain = _search(files, r'\[chain\]|_log_count_chain|row.?count|input .*->|-> .*output|'
                           r'before.*after', 'the row-count chain: input -> transform -> output')
    counts = _search(files, r'\.height\b|len\(\w+\)|\.shape\b|n_rows|nrow', 'row-count reads')
    closes = _search(files, r'does not close|!=.*height|AssertionError.*chain|chain does not',
                     'whether the chain is ASSERTED to close')
                     
    return render_json('DQ4', files, {}, [chain, counts, closes])
