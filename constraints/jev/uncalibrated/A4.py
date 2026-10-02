"""UNCALIBRATED -- not wired. Calibration 2026-10-02: margin +0.02: violating 0.15, compliant 0.11. The extractor drops its figure_reference_within_6_lines flag, so "See fig. 1." and "See above." look alike.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
import re
from _common import _search, _read, _hits, _tables_in_md, render_json

PROPOSITION = 'The state contains a MAIN RESULT table (estimates, accuracy, a go/no-go gate, a cross-tabulation that supports a claim) with NO companion figure that conveys the same result.'

CRITERIA = {
    'VIOLATED': 'a main-result table is present and no figure conveys the same result',
    'SATISFIED': 'every main-result table has a companion figure',
    'NOT_APPLICABLE': 'the state has no main-result table -- only sample descriptions, data-quality diagnostics or intermediate outputs',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

FIG_RX = r'!\[|\.png\b|\.pdf\b|\.svg\b|savefig|plt\.subplots|Figure \d|figure \d|fig\.'

def evidence(files, plan_lines=None):
    tables, figs = [], []
    for rel, abs_path in files:
        lines = _read(abs_path)
        if lines is None:
            continue
        if rel.endswith(('.md', '.markdown')):
            for ln, cap, hdr, nrows in _tables_in_md(lines):
                end = ln
                while end < len(lines) and re.match(r'^\s*\|', lines[end]):
                    end += 1
                near = '\n'.join(lines[max(0, ln - 6):min(len(lines), end + 6)])
                tables.append({'file': rel, 'line': ln, 'caption_or_preceding_line': cap[:200],
                               'header': hdr[:240], 'data_rows': nrows,
                               'figure_reference_within_6_lines':
                                   bool(re.search(FIG_RX, near, re.I))})
        for n, t in _hits(lines, r'write_csv|to_csv\(|write_parquet|as_csv_text'):
            near = '\n'.join(lines[max(0, n - 12):min(len(lines), n + 12)])
            tables.append({'file': rel, 'line': n, 'caption_or_preceding_line':
                           'a table this script WRITES', 'header': t.strip()[:240],
                           'data_rows': None,
                           'figure_reference_within_6_lines':
                               bool(re.search(r'savefig|plt\.', near, re.I))})
        figs += [{'file': rel, 'line': n, 'text': t.strip()[:200]}
                 for n, t in _hits(lines, FIG_RX)[:40]]
                 
    inventory = {
        'tables': [{k: v for k, v in t.items()
                    if k != 'figure_reference_within_6_lines'}
                   for t in tables],
        'n_tables': len(tables),
        'figure_references': figs,
        'n_figure_references': len(figs)
    }
    
    s = _search(files, FIG_RX, 'every figure / plot / image reference')
    return render_json('A4', files, inventory, [s])
