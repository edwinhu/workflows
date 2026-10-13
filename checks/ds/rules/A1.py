"""A1: a specification curve is never the only robustness check. Calibrated 2026-10-02, two runs: vio2 0.93-0.95, sat2 <=0.12, real run_core_estimands <=0.07."""
import ast
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_py, parse, py_files, sources, split_comments

PROPOSITION = ('A specification curve in these files stands with no robustness check of a different kind beside '
               'it. A specification curve is an estimator run across a grid of specification choices (controls, '
               'samples, winsorizing). A robustness check of a different kind is a placebo or falsification test, '
               'bootstrap or permutation inference, leave-one-out or jackknife, an instrumental variable, or a '
               'regression discontinuity. In the state, that is a specification_curve_sites entry with '
               'robustness_check_in_files false.')

CRITERIA = {
    'VIOLATED': 'some specification curve site has robustness_check_in_files false: the curve is the only check',
    'SATISFIED': 'every specification curve site has robustness_check_in_files true',
    'NOT_APPLICABLE': 'specification_curve_sites is empty: the files estimate no specification curve',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('specification_curve_sites',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'

# an estimator call: a library model, or a project helper whose name says it fits a regression
ESTIMATOR = re.compile(r'^(OLS|WLS|GLS|Logit|Probit|Poisson|PanelOLS|RandomEffects|BetweenOLS|FirstDifferenceOLS|'
                       r'IV2SLS|IVGMM|IVLIML|AbsorbingLS|QuantReg|ols|wls|glm|logit|probit|poisson|feols|fepois|'
                       r'rdrobust|lm|\w*_ols|ols_\w*|\w*regress\w*|\w*estimat\w*)$')
# a spec-curve library imported, or a spec-curve function called -- never a file or column name
SPEC_CURVE = re.compile(r'^\s*(from|import)\s+(specr|specification_curve|spec_curve)\b|'
                        r'\b\w*spec(ification)?_?curve\w*\s*\(|\bSpecificationCurve\s*\(', re.IGNORECASE)
CHECKS = [
    ('placebo', re.compile(r'placebo|falsif', re.IGNORECASE)),
    ('resampling_inference', re.compile(r'bootstrap|\bresampl|permutation|permute|randomi[sz]ation.?inference',
                                        re.IGNORECASE)),
    ('leave_one_out', re.compile(r'leave.?one.?out|\bloo\b|jackknife', re.IGNORECASE)),
    ('instrumental_variable', re.compile(r'\bIV2SLS\b|\bIVGMM\b|\bIVLIML\b|instrument|first.?stage')),
    ('regression_discontinuity', re.compile(r'rdrobust|\brdd\b|discontinuity|bandwidth', re.IGNORECASE)),
]


def _name(func):
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _docstring_lines(tree):
    """Line numbers held by module, class and function docstrings: prose about the code, not code."""
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                    and isinstance(first.value.value, str):
                out.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    return out


def _loops(tree):
    """For each estimator call: the for-loops and comprehensions enclosing it, outermost first."""
    found = []

    def walk(node, stack):
        name = _name(node.func) if isinstance(node, ast.Call) else None
        if name and ESTIMATOR.match(name):
            found.append((node, list(stack)))
        loop = isinstance(node, (ast.For, ast.AsyncFor, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp))
        for child in ast.iter_child_nodes(node):
            walk(child, stack + [node] if loop else stack)

    walk(tree, [])
    return found


def _iterables(src, loop):
    gens = loop.generators if hasattr(loop, 'generators') else [loop]
    return [clip(ast.get_source_segment(src, g.iter) or '') for g in gens]


def _sibling_checks(siblings):
    """Robustness check sites in the untouched files of the touched files' package tree, the files read and
    their lines: the check a module keeps in verify.py, its parent package or a sibling package stands beside
    the curve its build.py runs. Only .py files, nearest first, stopping after the first file with a check:
    one settles the question, and the rest would only grow the judge's state."""
    out, read, n_lines = [], [], 0
    for rel, path in py_files(siblings):
        for _, lines in sources([(rel, path)]):
            tree = parse(lines)
            if tree is None:
                continue
            read.append(rel)
            n_lines += len(lines)
            code, _ = split_comments(lines)
            docs = _docstring_lines(tree)
            for n, t in enumerate(code, 1):
                kinds = [k for k, rx in CHECKS if n not in docs and t.strip() and rx.search(t)]
                if kinds:
                    out.append({'file': rel, 'line': n, 'kinds': kinds, 'text': clip(lines[n - 1]), 'sibling': True})
        if out:
            break
    return out, read, n_lines


def evidence(files, plan_lines=None, siblings=None):
    estimations, curves, checks, robustness_loops, n_lines = [], [], [], [], 0
    for rel, lines in sources(files):
        tree = parse(lines) if is_py(rel) else None
        if tree is None:
            continue
        src = '\n'.join(lines)
        n_lines += len(lines)
        code, _ = split_comments(lines)
        docs = _docstring_lines(tree)
        check_lines = set()
        for n, t in enumerate(code, 1):
            if n in docs or not t.strip():
                continue
            if SPEC_CURVE.search(t):
                curves.append({'file': rel, 'line': n, 'estimator': None, 'text': clip(lines[n - 1]),
                               'grid': [], 'why': 'a specification-curve library or function named in code'})
            kinds = [k for k, rx in CHECKS if rx.search(t)]
            if kinds:
                check_lines.add(n)
                checks.append({'file': rel, 'line': n, 'kinds': kinds, 'text': clip(lines[n - 1])})
        for node, stack in _loops(tree):
            name = _name(node.func)
            looped = [it for loop in stack for it in _iterables(src, loop)]
            estimations.append({'file': rel, 'line': node.lineno, 'estimator': name,
                                'text': clip(lines[node.lineno - 1]), 'enclosing_loops_over': looped[:6]})
            if not looped:
                continue
            inner = stack[-1]
            # the innermost loop draws placebos or resamples: it is the check, not a specification grid
            if any(inner.lineno <= n <= (inner.end_lineno or inner.lineno) for n in check_lines):
                robustness_loops.append(f'{rel}:{node.lineno} {clip(lines[node.lineno - 1])}')
                continue
            curves.append({'file': rel, 'line': node.lineno, 'estimator': name,
                           'text': clip(lines[node.lineno - 1]), 'grid': looped[:6],
                           'why': 'estimator called inside a loop over specification choices'})
    # the package tree can only decide a curve the touched files leave unchecked; read it for nothing else
    sib_checks, sib_read, n_sib_lines = _sibling_checks(siblings or []) if curves and not checks else ([], [], 0)
    checks += sib_checks
    for c in curves:
        c['robustness_check_in_files'] = bool(checks)
    curves.sort(key=lambda c: c['estimator'] is None)
    inventory = {
        'sites_note': ('code only: comments and docstrings are excluded. An estimation site is an estimator '
                       'call; a specification-curve site is one called inside a for-loop or comprehension whose '
                       'innermost loop is not itself a placebo/resampling loop, or '
                       'a spec-curve library/function named in code. A robustness check site is a code line '
                       'naming a placebo/falsification, bootstrap/permutation, leave-one-out/jackknife, IV or '
                       'RDD check; winsorizing, subsamples and control sets are deliberately not counted'),
        'specification_curve_sites': curves[:MAX_ITEMS],
        'robustness_check_sites': checks[:MAX_ITEMS],
        'estimation_sites': estimations[:MAX_ITEMS],
        'estimations_inside_a_robustness_loop': robustness_loops[:MAX_ITEMS],
        'n_estimation_sites': len(estimations),
        'n_specification_curve_sites': len(curves),
        'n_robustness_check_sites': len(checks),
        'n_specification_curve_sites_without_robustness_check':
            sum(not c['robustness_check_in_files'] for c in curves),
        'n_lines_searched': n_lines,
        'robustness_check_kinds': sorted({k for c in checks for k in c['kinds']}),
    }
    # only when the package tree has siblings, so a lone file's state is what it was when A1 was calibrated
    if n_sib_lines:
        inventory['sites_note'] += ('. A robustness check site may sit in an untouched module of the same package, '
                                    'its parent package or a sibling package (sibling true): it stands beside the '
                                    'curve; specification curve sites come from the touched files only')
        inventory['sibling_files_read'] = sib_read[:MAX_ITEMS]
        inventory['n_sibling_lines_searched'] = n_sib_lines
    return render_json('A1', py_files(files), inventory, [])
