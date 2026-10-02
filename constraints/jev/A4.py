"""A4: every main-result table has a companion figure. Calibrated 2026-10-02, two runs: vio2 0.96-0.98, sat2 0.01, real xs5_table2 0.00."""
import re

from _common import _tables_in_md, render_json
from _ds import MAX_ITEMS, clip, is_prose, is_py, sources, split_comments

PROPOSITION = ('A MAIN-RESULT table -- one whose header or caption carries estimates (coefficients, standard '
               'errors, t-statistics, effects, a regression or DiD table) -- appears with no companion figure '
               'conveying the same result: in prose, no figure embedded or referenced within 6 lines of it; in '
               'code, no figure produced in the same file. In the state, that is a table with main_result true '
               'and companion_figure false.')

CRITERIA = {
    'VIOLATED': 'some main-result table has no companion figure',
    'SATISFIED': 'every main-result table has a companion figure beside it',
    'NOT_APPLICABLE': 'the files contain no main-result table -- only sample descriptions, diagnostics or intermediate outputs',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

RESULT = re.compile(r'\bcoef|\bestimate|\bstd\.? ?err|\bs\.e\.|\(se\)|t-stat|t\.stat|\bbeta\b|β|'
                    r'\bDiD\b|diff(erence)?-in-diff|regression|\bR\^?2\b|R²|adj\.? r|\bp-?value',
                    re.IGNORECASE)
MD_FIG = re.compile(r'!\[|\{#?@?fig|@fig-|\bFigure \d|\bFig\. ?\d|#?\bimage\(|\\includegraphics', re.IGNORECASE)
PY_TABLE = re.compile(r'\bGT\(|summary_col\(|Stargazer\(|\.to_latex\(|\.as_latex\(|esttab|etable\(|'
                      r'\.summary\(\)\.tables|modelsummary\(')
PY_FIG = re.compile(r'savefig\(|plt\.\w+\(|\bPlot\(|alt\.Chart\(|\bpx\.\w+\(|\bsns\.\w+\(|\.plot\(|'
                    r'coefplot|ggplot\(|plot_\w+\(')
NEAR = 6


def evidence(files, plan_lines=None):
    tables = []
    for rel, lines in sources(files):
        if is_prose(rel):
            for line, caption, header, n_rows in _tables_in_md(lines):
                near = [k for k in range(max(1, line - NEAR), min(len(lines), line + n_rows + 1 + NEAR) + 1)
                        if MD_FIG.search(lines[k - 1])]
                tables.append({'file': rel, 'line': line, 'caption': clip(caption or ''),
                               'header': clip(header or ''), 'n_rows': n_rows,
                               'main_result': bool(RESULT.search(' '.join([caption or ''] + lines[line - 1:line + 1 + n_rows]))),
                               'companion_figure': bool(near), 'figure_lines': near[:3]})
        elif is_py(rel):
            code, _ = split_comments(lines)
            figs = [n for n, t in enumerate(code, 1) if PY_FIG.search(t)]
            for n, t in enumerate(code, 1):
                if PY_TABLE.search(t):
                    ctx = ' '.join(code[max(0, n - 8):n + 2])
                    tables.append({'file': rel, 'line': n, 'text': clip(lines[n - 1]),
                                   'main_result': bool(RESULT.search(ctx)) or bool(re.search(
                                       r'summary_col|Stargazer|esttab|etable|modelsummary', t)),
                                   'companion_figure': bool(figs), 'figure_lines': figs[:3]})
    tables.sort(key=lambda t: (not t['main_result'], t['companion_figure']))
    inventory = {
        'tables_note': ('main_result = the caption, the table cells or (code) the 8 lines before it name estimates; '
                        'companion_figure = prose: a figure embed or reference within 6 lines; code: a plot '
                        'produced in the same file'),
        'tables': tables[:MAX_ITEMS],
        'n_tables': len(tables),
        'n_main_result_tables_without_figure': sum(t['main_result'] and not t['companion_figure'] for t in tables),
    }
    return render_json('A4', files, inventory, [])
