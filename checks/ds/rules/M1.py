"""M1: every output lands under a path the approved plan declares. Calibrated 2026-10-02, two runs: vio2 0.97, sat2 <=0.01, real 08_agk_sample <=0.01."""
import ast
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_py, parse, py_files, sources

PROPOSITION = ('The approved plan declares where its deliverables go, and at least one output the code writes '
               'lands at a path the plan does NOT declare (typically scratch/ or /tmp) -- so a deliverable the '
               'plan names is not produced where the plan says. In the state, that is a write with '
               'under_a_plan_declared_path false.')

CRITERIA = {
    'VIOLATED': 'some write goes to a path outside every path the plan declares',
    'SATISFIED': 'every write goes to a path the plan declares',
    'NOT_APPLICABLE': 'no plan was supplied, the plan declares no output path, or the code writes nothing',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('writes',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'

WRITERS = {'write_parquet', 'write_csv', 'to_csv', 'to_parquet', 'savefig', 'write_text', 'write_json',
           'to_excel', 'write_excel', 'to_latex', 'to_json', 'save', 'write_ipc', 'to_feather', 'to_stata'}
PATHISH = re.compile(r'(?<![\w/])(?:\./)?((?:[\w.-]+/)*[\w.-]+\.(?:parquet|csv|tsv|png|pdf|svg|tex|json|xlsx|'
                     r'feather|dta|html|md)|(?:data|output|outputs|results|figures|tables|exhibits|scratch)/'
                     r'[\w./-]*)')


def _strings(node, consts):
    """Best-effort literal path of an expression: a string, a NAME bound to one, a / join, an f-string."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return consts.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        a, b = _strings(node.left, consts), _strings(node.right, consts)
        return f'{a}/{b}' if a is not None and b is not None else (a or b)
    if isinstance(node, ast.Call) and node.args:
        return _strings(node.args[0], consts)
    if isinstance(node, ast.JoinedStr):
        return ''.join(v.value if isinstance(v, ast.Constant) else '*' for v in node.values)
    return None


def _norm(p):
    return re.sub(r'^\./', '', p.strip().strip('"\'`')).rstrip('/')


def _declared(plan_lines):
    out = []
    for t in plan_lines or []:
        out += [_norm(m.group(1)) for m in PATHISH.finditer(t)]
    return sorted(set(out))


def _under(path, declared):
    p = _norm(path)
    for d in declared:
        if '*' in p:
            pre = p.split('*')[0]
            if d.startswith(pre) or pre.startswith(d):
                return True
        if p == d or p.endswith('/' + d) or p.startswith(d + '/') or ('/' + d + '/') in p:
            return True
    return False


def evidence(files, plan_lines=None):
    declared = _declared(plan_lines)
    writes, n_lines = [], 0
    for rel, lines in sources(files):
        tree = parse(lines) if is_py(rel) else None
        if tree is None:
            continue
        n_lines += len(lines)
        consts = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                v = _strings(node.value, consts)
                if v is not None:
                    consts[node.targets[0].id] = v
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in WRITERS):
                continue
            arg = node.args[0] if node.args else next((k.value for k in node.keywords
                                                       if k.arg in ('path', 'file', 'fname', 'path_or_buf')), None)
            path = _strings(arg, consts) if arg is not None else None
            if node.func.attr == 'write_text' and isinstance(node.func.value, ast.AST):
                path = _strings(node.func.value, consts) or path
            p = _norm(path) if path else None
            writes.append({'file': rel, 'line': node.lineno, 'text': clip(lines[node.lineno - 1]),
                           'resolved_path': p,
                           'under_scratch_or_tmp': bool(p) and bool(re.match(r'(scratch|tmp|/tmp|\.tmp)/', p)),
                           'under_a_plan_declared_path': bool(p) and bool(declared) and _under(p, declared)})
    writes.sort(key=lambda w: w['under_a_plan_declared_path'])
    inventory = {
        'plan_supplied': plan_lines is not None,
        'plan_declared_paths': declared[:MAX_ITEMS],
        'writes_note': 'resolved_path follows string literals, NAME = "..." bindings and Path / joins',
        'writes': writes[:MAX_ITEMS],
        'n_lines_searched': n_lines,
        'n_writes': len(writes),
        'n_writes_outside_plan_paths': sum(not w['under_a_plan_declared_path'] for w in writes),
    }
    return render_json('M1', py_files(files), inventory, [])
