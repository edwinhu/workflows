"""M1: every output lands under a path the approved plan declares. Calibrated 2026-11-13, two invocations of
two runs: vio2 0.98, sat2 0.01, real 08_agk_sample <=0.06, real nevada_snapshot_switch 0.01."""
import ast
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_py, parse, py_files, sources

PROPOSITION = ('The approved plan declares where its deliverables go, and at least one output the code writes '
               'lands at a path the plan does NOT declare (typically scratch/ or /tmp) -- so a deliverable the '
               'plan names is not produced where the plan says. In the state, that is a write with '
               'under_a_plan_declared_path false (n_writes_outside_plan_paths > 0), or a write with '
               'under_a_plan_declared_path null whose an_undeclared_candidate is true. A null write whose '
               'candidates are all declared is not a write outside the plan.')

CRITERIA = {
    'VIOLATED': ('some resolved write goes to a path outside every path the plan declares, or some unresolved '
                 'write (under_a_plan_declared_path null) has an_undeclared_candidate true'),
    'SATISFIED': ('every resolved write goes to a path the plan declares, and every unresolved write has '
                  'an_undeclared_candidate false'),
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
    """Best-effort literal path of an expression: a string, a NAME bound to one, a / join, an f-string,
    a constant-key subscript of a module-level dict literal."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        v = consts.get(node.id)
        return v if isinstance(v, str) else None
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        a, b = _strings(node.left, consts), _strings(node.right, consts)
        return f'{a}/{b}' if a is not None and b is not None else (a or b)
    if isinstance(node, ast.Call) and node.args:
        return _strings(node.args[0], consts)
    if isinstance(node, ast.JoinedStr):
        return ''.join(v.value if isinstance(v, ast.Constant) else '*' for v in node.values)
    if isinstance(node, ast.Subscript):
        v = _value(node, consts)
        return v if isinstance(v, str) else None
    return None


def _value(node, consts):
    """A path string, or a {key: value} dict for a dict literal / constant-key subscript into one."""
    if isinstance(node, ast.Dict):
        return {k.value: _value(v, consts) for k, v in zip(node.keys, node.values)
                if isinstance(k, ast.Constant) and isinstance(k.value, (str, int))}
    if isinstance(node, ast.Name) and isinstance(consts.get(node.id), dict):
        return consts[node.id]
    if isinstance(node, ast.Subscript):
        base = _value(node.value, consts) if isinstance(node.slice, ast.Constant) else None
        return base.get(node.slice.value) if isinstance(base, dict) else None
    return _strings(node, consts)


def _targets(node):
    """(Name targets bound to the value, Name targets bound by unpacking) of an assignment-like node."""
    tg = node.targets if isinstance(node, ast.Assign) else [node.target]
    direct, unpacked = [], []
    for t in tg:
        if isinstance(t, ast.Name):
            direct.append(t.id)
        else:
            unpacked += [n.id for n in ast.walk(t) if isinstance(n, ast.Name)]
    return direct, unpacked


def _own_nodes(scope):
    """Nodes of a scope's body, not descending into nested functions or classes."""
    stack = list(scope.body)
    while stack:
        n = stack.pop(0)
        yield n
        for c in ast.iter_child_nodes(n):
            if not isinstance(c, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                stack.append(c)


def _module_scope(tree):
    """Module-level bindings in source order: name -> path string or dict; plus every name bound there."""
    consts, bound = {}, set()
    for n in _own_nodes(tree):
        if isinstance(n, (ast.Assign, ast.AnnAssign)) and getattr(n, 'value', None) is not None:
            direct, unpacked = _targets(n)
            bound.update(direct + unpacked)
            v = _value(n.value, consts)
            for name in direct:
                if v is not None:
                    consts[name] = v
                else:
                    consts.pop(name, None)
    return consts, bound


def _function_scopes(tree, consts):
    """Per function: params, globals, {local name: [path or None per binding]}, names it rebinds unresolvably."""
    out = {}
    for f in ast.walk(tree):
        if not isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        a = f.args
        params = {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs}
        params |= {x.arg for x in (a.vararg, a.kwarg) if x}
        glob, local, opaque = set(), {}, set()
        env = dict(consts)
        for n in _own_nodes(f):
            if isinstance(n, (ast.Global, ast.Nonlocal)):
                glob.update(n.names)
            elif isinstance(n, (ast.Assign, ast.AnnAssign)) and getattr(n, 'value', None) is not None:
                direct, unpacked = _targets(n)
                if isinstance(n.value, ast.Constant) and n.value.value is None:
                    continue  # NAME = None binds no path: a write guarded on it does not run
                v = _value(n.value, env)
                for name in direct:
                    local.setdefault(name, []).append(v if isinstance(v, str) else None)
                    if isinstance(v, str):
                        env[name] = v
                for name in unpacked:
                    opaque.add(name)
            elif isinstance(n, (ast.For, ast.AsyncFor, ast.withitem, ast.AugAssign, ast.NamedExpr)):
                tgt = n.optional_vars if isinstance(n, ast.withitem) else getattr(n, 'target', None)
                opaque.update(x.id for x in ast.walk(tgt) if isinstance(x, ast.Name)) if tgt else None
        out[f] = {'params': params, 'globals': glob, 'local': local, 'opaque': opaque}
    return out


def _keyed(consts, name):
    """Values of module-level dict entries keyed by NAME, at any depth: {"TABLE_PATH": TABLE_PATH_2026}."""
    found = []

    def walk(d):
        for k, v in d.items():
            if isinstance(v, dict):
                walk(v)
            elif k == name and isinstance(v, str):
                found.append(v)
    for v in consts.values():
        if isinstance(v, dict):
            walk(v)
    return found


def _resolve(arg, func, scopes, consts, rebound_globals):
    """(paths, reason, candidates): paths a list of every literal the write can target, or None when the
    target is selected at runtime; then reason names why, and candidates lists the values known for it."""
    if not isinstance(arg, ast.Name):
        if isinstance(arg, ast.Attribute):
            return None, 'attribute of another object (e.g. a config module), not followed', []
        p = _strings(arg, consts)
        if p is None and isinstance(arg, (ast.Call, ast.BinOp)):
            names = [n for n in ast.walk(arg) if isinstance(n, ast.Name)]
            if names:  # a join on a runtime-selected base: resolve the base, keep the literal tail
                base, reason, cands = _resolve(names[0], func, scopes, consts, rebound_globals)
                if base is None:
                    return None, reason, cands
        return ([p], None, []) if p is not None else (None, 'expression the resolver cannot follow', [])
    name, sc = arg.id, scopes.get(func)
    if sc and name in sc['params']:
        return None, f'function parameter {name}', []
    if sc and name in sc['local'] and name not in sc['globals']:
        vals = sc['local'][name]
        if name in sc['opaque'] or any(v is None for v in vals):
            return None, f'local {name} bound to an expression the resolver cannot follow', \
                sorted({v for v in vals if v})
        return sorted(set(vals)), None, []
    if sc and name in sc['opaque'] and name not in sc['globals']:
        return None, f'local {name} bound by unpacking or a loop', []
    if name in rebound_globals:
        mod = consts.get(name)
        cands = sorted(set(([mod] if isinstance(mod, str) else []) + _keyed(consts, name)))
        return None, f'module global {name} rebound at runtime (global + unpacking in {rebound_globals[name]})', cands
    v = consts.get(name)
    return ([v], None, []) if isinstance(v, str) else (None, f'{name} is not bound to a path literal', [])


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


def _decl(p, declared):
    return bool(declared) and _under(p, declared)


def evidence(files, plan_lines=None):
    declared = _declared(plan_lines)
    writes, literals, n_lines = [], [], 0
    for rel, lines in sources(files):
        tree = parse(lines) if is_py(rel) else None
        if tree is None:
            continue
        n_lines += len(lines)
        consts, _ = _module_scope(tree)
        scopes = _function_scopes(tree, consts)
        rebound = {}
        for f, sc in scopes.items():
            for name in sc['globals'] & (sc['opaque'] | {n for n, v in sc['local'].items() if None in v}):
                rebound.setdefault(name, f.name)
        parent = {}
        for f in scopes:
            for n in ast.walk(f):
                parent.setdefault(n, f) if n is not f else None
        file_writes = []
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in WRITERS):
                continue
            arg = node.args[0] if node.args else next((k.value for k in node.keywords
                                                       if k.arg in ('path', 'file', 'fname', 'path_or_buf')), None)
            if node.func.attr == 'write_text' or arg is None:
                arg = node.func.value if node.func.attr == 'write_text' else arg
            if arg is None:
                paths, reason, cands = None, 'no path argument', []
            else:
                paths, reason, cands = _resolve(arg, parent.get(node), scopes, consts, rebound)
            paths = [_norm(p) for p in paths] if paths else None
            w = {'file': rel, 'line': node.lineno, 'text': clip(lines[node.lineno - 1]),
                 'resolved_path': paths[0] if paths and len(paths) == 1 else None}
            if paths and len(paths) > 1:
                w['resolved_paths'] = paths
            if paths:
                w['under_scratch_or_tmp'] = any(re.match(r'(scratch|tmp|/tmp|\.tmp)/', p) for p in paths)
                w['under_a_plan_declared_path'] = all(_decl(p, declared) for p in paths)
            else:
                w['under_scratch_or_tmp'] = None
                w['under_a_plan_declared_path'] = None
                w['unresolved_because'] = reason
                if cands:
                    w['candidate_paths'] = [{'path': _norm(c), 'declared': _decl(_norm(c), declared)}
                                            for c in cands]
            file_writes.append(w)
        file_lits = [{'file': rel, 'name': k, 'path': _norm(v), 'declared': _decl(_norm(v), declared)}
                     for k, v in consts.items() if isinstance(v, str) and PATHISH.search(_norm(v))]
        undeclared = any(not x['declared'] for x in file_lits)
        for w in file_writes:
            if w['under_a_plan_declared_path'] is None:
                known = w.get('candidate_paths')
                w['an_undeclared_candidate'] = (any(not c['declared'] for c in known) if known
                                                else undeclared)
        if any(w['under_a_plan_declared_path'] is None for w in file_writes):
            literals += file_lits
        writes += file_writes
    order = {False: 0, None: 1, True: 2}
    writes.sort(key=lambda w: (order[w['under_a_plan_declared_path']], not w.get('an_undeclared_candidate')))
    unresolved = [w for w in writes if w['under_a_plan_declared_path'] is None]
    literals.sort(key=lambda x: x['declared'])
    inventory = {
        'plan_supplied': plan_lines is not None,
        'plan_declared_paths': declared[:MAX_ITEMS],
        'writes_note': ('resolved_path follows string literals, NAME = "..." and NAME = BASE / "..." bindings '
                        '(module level and in the enclosing function; a name bound on several branches '
                        'lists every value in resolved_paths), and constant-key subscripts of module-level dict '
                        'literals. under_a_plan_declared_path is null when the target is selected at runtime '
                        '(a parameter, a global rebound by unpacking, an attribute): then candidate_paths lists '
                        'the values known for that name, and an_undeclared_candidate says whether any of them, '
                        'or when none is known any path literal of the file, is undeclared.'),
        'writes': writes[:MAX_ITEMS],
        'module_path_literals_note': ('for each file with an unresolved write: every module-level name bound to '
                                      'a path literal, with whether the plan declares it'),
        'module_path_literals': literals[:MAX_ITEMS],
        'n_lines_searched': n_lines,
        'n_writes': len(writes),
        'n_writes_outside_plan_paths': sum(w['under_a_plan_declared_path'] is False for w in writes),
        'n_writes_unresolved': len(unresolved),
        'n_unresolved_writes_with_an_undeclared_candidate': sum(bool(w['an_undeclared_candidate'])
                                                                 for w in unresolved),
    }
    return render_json('M1', py_files(files), inventory, [])
