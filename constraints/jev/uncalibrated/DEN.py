"""UNCALIBRATED -- not wired. Calibration 2026-10-02: margin +0.36: violating 1.00, but the compliant fixture scored 0.60-0.63 and both E7 fixtures (no rate at all) 0.92. The extractor drops its own base_stated_within_2_lines flag, so Jev guesses whether a base is stated.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import re
from _common import _search, _read, _hits, render_json

PROPOSITION = 'At least one rate, share or percentage in the state is reported WITHOUT the base it was computed over stated beside it.'

CRITERIA = {
    'VIOLATED': 'some reported rate has no base (count, column or stated denominator) beside it',
    'SATISFIED': 'every reported rate names the base it is computed over',
    'NOT_APPLICABLE': 'the state reports no rate, share or percentage at all',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

RATE_RX = (r'(:\.\d+%\}|:\.\d+%\"|\bshare\b|\brate\b|\bpct\b|percent|'
           r'\d+(\.\d+)?%|:,?\.\d+%)')
BASE_RX = r'denominator|\bbase\b|of the \{|/ ?len\(|/ ?n_|/ ?\w+\.height|/ ?max\(|out of|\bnumerator\b'

def evidence(files, plan_lines=None):
    rates = _search(files, RATE_RX, 'lines that REPORT a rate, share or percentage', window=1)
    base = _search(files, BASE_RX, 'lines that STATE a base/denominator for a rate')
    
    pairs = []
    for rel, abs_path in files:
        lines = _read(abs_path)
        if lines is None:
            continue
        for n, t in _hits(lines, RATE_RX)[:40]:
            near = '\n'.join(lines[max(0, n - 3):min(len(lines), n + 2)])
            pairs.append({'file': rel, 'line': n, 'rate_text': t.strip()[:240],
                          'base_stated_within_2_lines': bool(re.search(BASE_RX, near, re.I))})
    
    inventory = {
        'reported_rates': [{k: v for k, v in p.items()
                            if k != 'base_stated_within_2_lines'}
                           for p in pairs],
        'n_rates': len(pairs)
    }
    return render_json('DEN', files, inventory, [rates, base])
