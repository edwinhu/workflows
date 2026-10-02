"""UNI: one universe definition, applied by every leg. Calibrated 2026-10-02, two runs: vio2 0.93-0.95, sat2 0.03, real ownership.py 0.01."""
import ast
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_py, parse, sources

PROPOSITION = ('The sample universe is defined in more than one place: the same entity column (share code, '
               'exchange, security type, SIC, the id set) is filtered by a LITERAL predicate written out '
               'independently at two or more sites, rather than every leg applying one shared definition. '
               'In the state, that is an entity column with n_literal_sites of 2 or more.')

CRITERIA = {
    'VIOLATED': 'some entity column is filtered by literal predicates written out at two or more sites',
    'SATISFIED': 'each entity column is filtered literally at most once; other legs apply the shared definition',
    'NOT_APPLICABLE': 'the files apply no universe predicate on an entity column',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

ENTITY = re.compile(r'^(shrcd|exchcd|shrcls|sharetype|share_type|securitytype|security_type|siccd|sic|sic2|'
                    r'exchange|primexch|issuertype|share_code|exch_code|permno|permco|gvkey|cik|cusip\d?|'
                    r'ticker|isin|fund_type|is_etf|is_index)$', re.IGNORECASE)
FILTERS = {'filter', 'query', 'loc', 'where'}


def _col(node):
    """The entity column a value expression names: df.col, df["col"], pl.col("col")."""
    if isinstance(node, ast.Attribute) and ENTITY.match(node.attr):
        return node.attr.lower()
    if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) \
            and isinstance(node.slice.value, str) and ENTITY.match(node.slice.value):
        return node.slice.value.lower()
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'col' \
            and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str) \
            and ENTITY.match(node.args[0].value):
        return node.args[0].value.lower()
    return None


def _written_out(node):
    """A comparand whose values are spelled out here: a constant or a collection of constants."""
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, ast.UnaryOp):
        return _written_out(node.operand)
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return all(_written_out(e) for e in node.elts)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ('range', 'set', 'list'):
        return all(_written_out(a) for a in node.args)
    return False


def _columns(node):
    """{column: literal} -- literal when some comparison on that column takes a written-out value.
    A method call (.isin(...), .notna()) is never itself a column; only its receiver can be."""
    cols = {}

    def mark(c, lit):
        if c:
            cols[c] = cols.get(c, False) or lit

    for n in ast.walk(node):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and n is node:
            for tok in re.findall(r'@?\w+', n.value):         # a query string writes its values out
                if ENTITY.match(tok):
                    mark(tok.lower(), '@' not in n.value)
        elif isinstance(n, ast.Compare):
            sides = [n.left, *n.comparators]
            for i, side in enumerate(sides):
                mark(_col(side), any(_written_out(o) for j, o in enumerate(sides) if j != i))
        elif isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ('isin', 'is_in', 'between'):
            mark(_col(n.func.value), bool(n.args) and all(_written_out(a) for a in n.args))
    return cols


def evidence(files, plan_lines=None):
    sites, shared = [], []
    for rel, lines in sources(files):
        tree = parse(lines) if is_py(rel) else None
        if tree is None:
            continue
        src = '\n'.join(lines)
        for node in ast.walk(tree):
            arg = None
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in FILTERS:
                arg = node.args[0] if node.args else None
            elif isinstance(node, ast.Subscript) and isinstance(node.slice, (ast.Compare, ast.Call, ast.BinOp, ast.BoolOp)):
                arg = node.slice
            if arg is None:
                continue
            cols = _columns(arg)
            if not cols:
                if isinstance(arg, (ast.Name, ast.Attribute)):
                    shared.append(f'{rel}:{node.lineno} {clip(lines[node.lineno - 1])}')
                continue
            sites.append({'file': rel, 'line': node.lineno, 'text': clip(lines[node.lineno - 1]),
                          'predicate': clip(ast.get_source_segment(src, arg) or ''),
                          'entity_columns': sorted(cols),
                          'literal_columns': sorted(c for c, lit in cols.items() if lit)})
    by_col = {}
    for s in sites:
        for c in s['literal_columns']:
            by_col.setdefault(c, []).append(f"{s['file']}:{s['line']}")
    columns = [{'column': c, 'n_literal_sites': len(v), 'sites': v[:12],
                'distinct_predicates': len({s['predicate'] for s in sites if c in s['literal_columns']})}
               for c, v in sorted(by_col.items(), key=lambda kv: -len(kv[1]))]
    inventory = {
        'predicate_sites_note': ('a site filters a frame on an entity column; literal_columns = the columns '
                                 'compared against values written out at the site (a constant or list) '
                                 'rather than a shared name'),
        'predicate_sites': sites[:MAX_ITEMS],
        'entity_columns': columns,
        'shared_definition_applications': shared[:MAX_ITEMS],
        'n_columns_filtered_literally_at_2_or_more_sites': sum(c['n_literal_sites'] >= 2 for c in columns),
    }
    return render_json('UNI', files, inventory, [])
