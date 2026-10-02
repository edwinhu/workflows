"""E7: a concurrent network client computes its rate against a cited ceiling. Calibrated 2026-10-02, two runs: vio2 1.00, sat2 0.00 (known-good substitute; the one real client, cl_download_opinion_pdfs.py, cites no ceiling and scores 1.00)."""
import ast
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_py, parse, sources, split_comments

PROPOSITION = ('Code fetches from a network host CONCURRENTLY (a worker pool, gather or semaphore) without all '
               'three facts that make the rate defensible: (1) the effective request rate computed in code, '
               '(2) a documented ceiling for that host cited with its source, and (3) the computed rate at or '
               'below that ceiling. In the state, that is a client with rate_computed false, ceiling_cited '
               'false, or rate_exceeds_ceiling true.')

CRITERIA = {
    'VIOLATED': 'a concurrent client lacks a computed rate or a cited ceiling, or its rate exceeds the ceiling',
    'SATISFIED': 'every concurrent client computes its rate, cites a documented ceiling, and stays at or below it',
    'NOT_APPLICABLE': 'no file fetches from the network concurrently',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

CONCURRENCY = re.compile(r'ThreadPoolExecutor\s*\(|ProcessPoolExecutor\s*\(|asyncio\.gather\s*\(|'
                         r'asyncio\.Semaphore\s*\(|\.map\(|limit_per_host\s*=|max_workers\s*=')
NETWORK = re.compile(r'requests\.(get|post|request|Session)|httpx\.|aiohttp\.|urllib\.request|urlopen\s*\(|'
                     r'session\.(get|post)\s*\(|client\.(get|post)\s*\(|curl_cffi')
RATE_NAME = re.compile(r'(RPS|RATE|PER_SEC|REQ_PER|REQUESTS_PER)', re.IGNORECASE)
CEIL_NAME = re.compile(r'CEILING|LIMIT|MAX_RPS|ALLOWED', re.IGNORECASE)
CEIL_TEXT = re.compile(r'(\d+(?:\.\d+)?)\s*(?:req(?:uest)?s?\s*(?:/|per)\s*s(?:ec(?:ond)?)?|rps\b)', re.IGNORECASE)
SOURCE = re.compile(r'https?://|documented|published|per (?:the |their )?docs|fair access|terms of', re.IGNORECASE)
LIMIT_RESPONSE = re.compile(r'\b429\b|Retry-After|rate.?limit|backoff|quota', re.IGNORECASE)


OPS = {ast.Add: float.__add__, ast.Sub: float.__sub__, ast.Mult: float.__mul__, ast.Div: float.__truediv__}


def _num(node, consts):
    """Value of a numeric literal / known-constant arithmetic expression, else None."""
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return float(node.value)
    if isinstance(node, ast.Name):
        return consts.get(node.id)
    if isinstance(node, ast.BinOp) and type(node.op) in OPS:
        a, b = _num(node.left, consts), _num(node.right, consts)
        if a is None or b is None or (isinstance(node.op, ast.Div) and b == 0):
            return None
        return OPS[type(node.op)](a, b)
    return None


def evidence(files, plan_lines=None):
    clients = []
    for rel, lines in sources(files):
        if not is_py(rel):
            continue
        code, comment = split_comments(lines)
        conc = [n for n, t in enumerate(code, 1) if CONCURRENCY.search(t)]
        net = [n for n, t in enumerate(code, 1) if NETWORK.search(t)]
        if not (conc and net):
            continue
        consts, rates, ceilings = {}, [], []
        tree = parse(lines)
        for node in ast.walk(tree) if tree else []:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                name, v = node.targets[0].id, _num(node.value, consts)
                if v is None:
                    continue
                consts[name] = v
                rec = {'line': node.lineno, 'name': name, 'value': round(v, 4), 'text': clip(lines[node.lineno - 1])}
                if CEIL_NAME.search(name):
                    near = ' '.join(lines[max(0, node.lineno - 3):node.lineno + 1])
                    ceilings.append({**rec, 'source_cited': bool(SOURCE.search(near))})
                elif RATE_NAME.search(name) and not isinstance(node.value, ast.Constant):
                    rates.append(rec)
        for n, t in enumerate(comment, 1):
            m = CEIL_TEXT.search(t)
            if m and SOURCE.search(' '.join(lines[max(0, n - 2):n + 1])):
                ceilings.append({'line': n, 'name': None, 'value': float(m.group(1)), 'text': clip(lines[n - 1]),
                                 'source_cited': True})
        rate = rates[-1]['value'] if rates else None
        cited = [c for c in ceilings if c['source_cited']]
        ceil = min(c['value'] for c in cited) if cited else None
        clients.append({'file': rel, 'concurrency_lines': conc[:4], 'network_lines': net[:4],
                        'rate_computations': rates[:6], 'ceiling_statements': ceilings[:6],
                        'rate_computed': bool(rates), 'ceiling_cited': bool(cited),
                        'computed_rate': rate, 'cited_ceiling': ceil,
                        'rate_exceeds_ceiling': rate is not None and ceil is not None and rate > ceil,
                        'rate_limit_response_handled': [n for n, t in enumerate(lines, 1)
                                                        if LIMIT_RESPONSE.search(t)][:4]})
    inventory = {
        'clients_note': ('a client is a file with both a concurrency construct and a network call; '
                         'rate_computed = a RATE/RPS-named constant computed by an expression (evaluated here); '
                         'ceiling_cited = a CEILING/LIMIT-named constant or an "N req/s" comment with a source '
                         '(URL, "documented", "published") within 2 lines'),
        'clients': clients[:MAX_ITEMS],
        'n_concurrent_clients': len(clients),
        'n_clients_failing_a_fact': sum((not c['rate_computed']) or (not c['ceiling_cited']) or
                                        c['rate_exceeds_ceiling'] for c in clients),
    }
    return render_json('E7', files, inventory, [])
