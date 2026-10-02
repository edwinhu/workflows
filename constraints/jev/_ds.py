"""Shared extraction for the ds rules: code/comment split, frame transforms, bounded records."""
import ast
import io
import re
import tokenize

from _common import _read

MAX_ITEMS = 60      # per inventory list; the state must stay well inside rule-check's 60000 chars
TEXT = 240
PROSE = ('.md', '.qmd', '.rst', '.txt', '.typ', '.tex')


def clip(s):
    s = s.strip()
    return s if len(s) <= TEXT else s[:TEXT] + '…'


def is_py(rel):
    return rel.endswith('.py')


def is_prose(rel):
    return rel.endswith(PROSE)


def split_comments(lines):
    """(code_part, comment_part) per line. Python files go through tokenize, so a '#' inside a
    string stays code; a file tokenize cannot read falls back to the first '#'."""
    code = list(lines)
    comment = [''] * len(lines)
    try:
        for tok in tokenize.generate_tokens(io.StringIO('\n'.join(lines) + '\n').readline):
            if tok.type == tokenize.COMMENT:
                r, c = tok.start
                comment[r - 1] = tok.string
                code[r - 1] = lines[r - 1][:c]
    except (tokenize.TokenError, IndentationError, SyntaxError):
        for i, t in enumerate(lines):
            if '#' in t:
                k = t.index('#')
                code[i], comment[i] = t[:k], t[k:]
    return code, comment


def sources(files):
    """[(rel, lines)] for every readable file."""
    out = []
    for rel, a in files:
        lines = _read(a)
        if lines is not None:
            out.append((rel, lines))
    return out


def parse(lines):
    try:
        return ast.parse('\n'.join(lines))
    except (SyntaxError, ValueError):
        return None


# ---- row-changing frame transforms (DQ4, DQ6) ------------------------------------------------

ROW_METHODS = {'filter', 'join', 'join_asof', 'merge', 'merge_asof', 'drop_nulls', 'dropna', 'unique',
               'drop_duplicates', 'query', 'explode', 'group_by', 'groupby', 'concat', 'vstack',
               'semi_join', 'anti_join', 'filter_by'}
EXPR_ONLY = {'col', 'lit', 'when', 'struct', 'element', 'str', 'list', 'dt', 'arr', 'over'}
# a chain ending here leaves the frame: a lookup or a check value, not a pipeline step
NOT_FRAME = {'to_dicts', 'to_list', 'tolist', 'to_numpy', 'item', 'rows', 'iter_rows', 'to_dict', 'values'}
COUNT_OF = (r'\b{n}\s*(?:\[[^\]]*\]\s*)?\.(?:height|shape|n_rows|count\(\s*\)|select\(\s*pl\.len)|'
            r'\b(?:len|nrow|n_rows)\(\s*{n}\b|'
            r'\b\w*(?:log|report|audit|count|rows|shape|trace|chain)\w*\s*\([^)]*\b{n}\b')
WINDOW = 6


def _chain(node):
    """Method names along the outermost call chain of an expression, and its root name."""
    names, cur = [], node
    while True:
        if isinstance(cur, ast.Call):
            cur = cur.func
        elif isinstance(cur, ast.Attribute):
            names.append(cur.attr)
            cur = cur.value
        elif isinstance(cur, ast.Subscript):
            cur = cur.value
        else:
            break
    return list(reversed(names)), (cur.id if isinstance(cur, ast.Name) else None)


def _first_frame_arg(node):
    if isinstance(node, ast.Call):
        for a in node.args:
            if isinstance(a, ast.Name):
                return a.id
            if isinstance(a, (ast.List, ast.Tuple)) and a.elts and isinstance(a.elts[0], ast.Name):
                return a.elts[0].id
    return None


def _counted(code, lo, hi, name):
    """Lines in [lo, hi] that record the row count or shape of `name`."""
    if not name:
        return []
    rx = re.compile(COUNT_OF.format(n=re.escape(name)), re.IGNORECASE)
    out = []
    for n in range(max(1, lo), min(len(code), hi) + 1):
        if rx.search(code[n - 1]):
            out.append(n)
    return out


def transform_sites(rel, lines):
    """Every statement that assigns a row-changing transform of a frame to a name."""
    tree = parse(lines)
    if tree is None:
        return []
    code, _ = split_comments(lines)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)) or node.value is None:
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if len(targets) != 1 or not isinstance(targets[0], ast.Name):
            continue
        methods, root = _chain(node.value)
        row = [m for m in methods if m in ROW_METHODS]
        if not row or EXPR_ONLY & set(methods) or methods[-1] in NOT_FRAME:
            continue
        source = root
        if root in ('pl', 'pd', 'np', None):
            source = _first_frame_arg(node.value)
        target = targets[0].id
        s, e = node.lineno, node.end_lineno or node.lineno
        before = _counted(code, s - WINDOW, s - 1, source)
        if source != target:
            before += _counted(code, e + 1, e + WINDOW, source)
        after = _counted(code, e + 1, e + WINDOW, target)
        out.append({'file': rel, 'line': s, 'end_line': e, 'statement': clip(lines[s - 1]),
                    'target': target, 'source': source, 'row_changing_methods': row,
                    'input_count_lines': sorted(set(before))[:4],
                    'output_count_lines': after[:4],
                    'input_count_shown': bool(before), 'output_count_shown': bool(after),
                    'before_and_after_shown': bool(before) and bool(after)})
    out.sort(key=lambda r: (r['file'], r['line']))
    return out


def in_scope(sites, changed):
    """(sites whose statement intersects the round's changed lines, n skipped as unchanged). `changed`
    maps file label -> [[lo, hi], ...]; a file it does not name has no diff info, so all its sites count."""
    if changed is None:
        return sites, 0
    keep = [s for s in sites
            if s['file'] not in changed
            or any(lo <= s['end_line'] and s['line'] <= hi for lo, hi in changed[s['file']])]
    return keep, len(sites) - len(keep)
