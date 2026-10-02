"""DEN: every reported rate states its base. Calibrated 2026-10-02, two runs: vio2 0.98-0.99, sat2 <=0.02, real universe.py <=0.07."""
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_prose, is_py, sources, split_comments

PROPOSITION = ('At least one REPORTED rate, share or percentage (printed, logged or written in prose) does not '
               'state the base it was computed over -- the denominator count, "of N", "n=" or "x/y" -- in the '
               'report itself. A rate computed in code but never reported is not a site. In the state, that '
               'is a rate site with base_stated false.')

CRITERIA = {
    'VIOLATED': 'some reported rate shows no denominator or base in its report',
    'SATISFIED': 'every reported rate states its denominator or base beside it',
    'NOT_APPLICABLE': 'the files report no rate, share or percentage',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

REPORT = re.compile(r'\b(print|log\w*|logger\.\w+|info|warning|write|echo)\s*\(|\bf["\']')
PY_RATE = re.compile(r'%\}|:[,_]?\.?\d*%|\d%|\bpercent\b|\bpct\b(?!\s*\()')
MD_RATE = re.compile(r'\d(\.\d+)?\s?%|\bpercent\b')
NOT_RATE = re.compile(r'req/s|\brps\b|rate.?limit|per second|%\(\w+\)s|%[sdr]\b', re.IGNORECASE)
BASE = re.compile(r'\}\s*/\s*\{|\{[^}]*\}\s*/\s*[\d,]+|[\d,]+\s*/\s*[\d,]+|\bof\s+(\{|[\d,]{2,}|the\s+[\{\d,]+)|'
                  r'out of|\bn\s*=\s*[\{\d]|\bbase\b|denominator|\[DEN\]', re.IGNORECASE)
# an interpolated absolute count ({n:,}, {len(x)}, {df.height}) -- never the percentage brace itself
COUNT = re.compile(r'\{(?![^{}]*%)[^{}]*(?:len\(|\.height\b|\.shape\b|\bn_\w+|:,)[^{}]*\}')
NEAR = 2


def evidence(files, plan_lines=None):
    sites = []
    for rel, lines in sources(files):
        if is_py(rel):
            code, _ = split_comments(lines)
            rate, text = PY_RATE, code
            hits = [n for n, t in enumerate(code, 1) if REPORT.search(t) and rate.search(t) and not NOT_RATE.search(t)]
        elif is_prose(rel):
            text = lines
            hits = [n for n, t in enumerate(lines, 1) if MD_RATE.search(t) and not NOT_RATE.search(t)]
        else:
            continue
        for n in hits:
            near = [k for k in range(max(1, n - NEAR), min(len(text), n + NEAR) + 1) if BASE.search(text[k - 1]) or COUNT.search(text[k - 1])]
            sites.append({'file': rel, 'line': n, 'text': clip(lines[n - 1]),
                          'base_stated': bool(near), 'base_lines': near[:3]})
    sites.sort(key=lambda s: s['base_stated'])
    inventory = {
        'rate_sites_note': ('a site is a printed/logged/f-string or prose line carrying a percentage; '
                            'base_stated = that line or one within 2 lines shows x/y, "of N", "out of", '
                            'n=, "base", "denominator" or an interpolated absolute count'),
        'rate_sites': sites[:MAX_ITEMS],
        'n_rate_sites': len(sites),
        'n_rates_without_base': sum(not s['base_stated'] for s in sites),
    }
    return render_json('DEN', files, inventory, [])
