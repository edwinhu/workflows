"""A1: a specification curve is never the only robustness check. Calibrated 2026-10-02, two runs: vio2 0.93-0.95, sat2 <=0.12, real run_core_estimands <=0.07."""
import ast
import os
import re
from collections import Counter

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
# modules one sibling-package file's imports may resolve to and be read for a hop or a re-export
MAX_HOP_FILES = 20


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


def _module(path):
    """The dotted components of a .py file's real path; an __init__.py names its package."""
    parts = os.path.splitext(os.path.realpath(path))[0].split(os.sep)[1:]
    return tuple(parts[:-1] if parts[-1] == '__init__' else parts)


def _imports(tree, path):
    """[(components, absolute)] of every module or name the file's imports could name. A relative import is
    resolved against the file's own package to full real-path components; an absolute one is a suffix."""
    mod = _module(path)
    pkg = mod if os.path.basename(path) == '__init__.py' else mod[:-1]
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out += [(tuple(a.name.split('.')), True) for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = pkg[:max(0, len(pkg) - node.level + 1)] if node.level else ()
            target = base + tuple((node.module or '').split('.')) if node.module else base
            out.append((target, not node.level))
            out += [(target + (a.name,), not node.level) for a in node.names if a.name != '*']
    return out


def _stem(path):
    """The module name a .py file answers to: its stem, or its package's name for an __init__.py."""
    base = os.path.basename(path)
    return os.path.basename(os.path.dirname(path)) if base == '__init__.py' else base[:-3]


def _root(siblings):
    """The project root siblings() labelled against: each label is its path relative to it; None without one."""
    for rel, path in siblings:
        full = os.path.abspath(path)
        if os.sep in rel and full.endswith(os.sep + rel):
            return os.path.realpath(full[:-len(rel) - 1])
    return None


def _resolve(c, absolute, path, root):
    """The real .py file inside root that an import candidate names -- a module, or a package's __init__.py --
    or None. An absolute candidate is rooted at the importer's own directory, then each ancestor up to root,
    nearest first; a relative one is already full real-path components."""
    if not c or not root:
        return None
    heads = [os.sep + os.path.join(*c)]
    if absolute:
        heads, d = [], os.path.dirname(os.path.realpath(path))
        while os.path.commonpath([d, root]) == root:
            heads.append(os.path.join(d, *c))
            if d == root:
                break
            d = os.path.dirname(d)
    for h in heads:
        for f in (h + '.py', os.path.join(h, '__init__.py')):
            real = os.path.realpath(f)
            if os.path.isfile(real) and os.path.commonpath([real, root]) == root:
                return real
    return None


def _hits(imports, path, target, ctx):
    """path's imports name the target file: a relative one exactly, an absolute one as a suffix of its real-path
    components. A one-component suffix (`import curve`) names any curve.py, so it counts only when no other
    file of that name is in the package tree read, or when it resolves from path to the target itself."""
    module = _module(target)
    for c, absolute in imports:
        if not c or (module[-len(c):] != c if absolute else module != c):
            continue
        if not absolute or len(c) > 1 or ctx['names'][c[0]] < 2 \
                or _resolve(c, True, path, ctx['root']) == os.path.realpath(target):
            return True
    return False


def _hop_imports(f, ctx):
    """The imports of a module one hop away, parsed once per evidence call."""
    if f not in ctx['cache']:
        tree = next((parse(lines) for _, lines in sources([(f, f)])), None)
        ctx['cache'][f] = _imports(tree, f) if tree is not None else []
    return ctx['cache'][f]


def _connected(path, tree, touched, ctx):
    """An import joins the file to a touched one: it imports a touched module (or a name from it), a touched
    file imports it, or -- exactly one hop -- a module it imports inside the root imports a touched module. A
    package's __init__.py is such a module, which is how a re-export (`from .curve import build`) connects.
    Never a second hop, and at most MAX_HOP_FILES modules per file. Static: trees are parsed, never imported."""
    mine = _imports(tree, path)
    if any(_hits(mine, path, t, ctx) or _hits(_imports(t_tree, t), t, path, ctx) for t, t_tree in touched):
        return True
    skip = {os.path.realpath(path)} | {os.path.realpath(t) for t, _ in touched}
    hops = []
    for c, absolute in mine:
        f = _resolve(c, absolute, path, ctx['root'])
        if f and f not in skip and f not in hops:
            hops.append(f)
            if len(hops) == MAX_HOP_FILES:
                break
    return any(_hits(_hop_imports(f, ctx), f, t, ctx) for f in hops for t, _ in touched)


def _sibling_checks(siblings, touched):
    """Robustness check sites in the untouched files of the touched files' package tree, the files read, their
    lines and the sibling-package files dropped: the check a module keeps in verify.py or its parent package
    stands beside the curve its build.py runs; one in a sibling package does only when an import connects it
    to a touched file, since a check in an unrelated subpackage is about some other estimate. Only .py files,
    nearest first, stopping after the first file whose check counts: one settles the question, and the rest
    would only grow the judge's state."""
    own = {os.path.dirname(os.path.abspath(t)) for t, _ in touched}
    near = own | {os.path.dirname(d) for d in own}
    tree_files = {os.path.realpath(p) for _, p in py_files(siblings)} | {os.path.realpath(t) for t, _ in touched}
    ctx = {'root': _root(siblings), 'cache': {}, 'names': Counter(_stem(f) for f in tree_files)}
    out, read, n_lines, dropped = [], [], 0, 0
    for rel, path in py_files(siblings):
        for _, lines in sources([(rel, path)]):
            tree = parse(lines)
            if tree is None:
                continue
            read.append(rel)
            n_lines += len(lines)
            code, _ = split_comments(lines)
            docs = _docstring_lines(tree)
            found = []
            for n, t in enumerate(code, 1):
                kinds = [k for k, rx in CHECKS if n not in docs and t.strip() and rx.search(t)]
                if kinds:
                    found.append({'file': rel, 'line': n, 'kinds': kinds, 'text': clip(lines[n - 1]),
                                  'sibling': True})
            # imports are parsed only for a sibling-package file that holds a check
            if found and os.path.dirname(os.path.abspath(path)) not in near \
                    and not _connected(path, tree, touched, ctx):
                dropped += 1
                continue
            out += found
        if out:
            break
    return out, read, n_lines, dropped


def evidence(files, plan_lines=None, siblings=None):
    estimations, curves, checks, robustness_loops, n_lines, touched = [], [], [], [], 0, []
    paths = dict(files)
    for rel, lines in sources(files):
        tree = parse(lines) if is_py(rel) else None
        if tree is None:
            continue
        touched.append((paths[rel], tree))
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
    sib_checks, sib_read, n_sib_lines, n_dropped = (_sibling_checks(siblings or [], touched)
                                                    if curves and not checks else ([], [], 0, 0))
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
    # only when one was dropped, so a state with no unconnected sibling package is what it was before
    if n_dropped:
        inventory['sites_note'] += ('. A sibling-package file counts only when it imports a touched module or a '
                                    'touched file imports it; n_unconnected_sibling_package_files_dropped files '
                                    'held a check-shaped line with no such import, so their lines are not '
                                    'robustness check sites here')
        inventory['n_unconnected_sibling_package_files_dropped'] = n_dropped
    return render_json('A1', py_files(files), inventory, [])
