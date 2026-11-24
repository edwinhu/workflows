import re
from _common import _read, render_json
from _dev import SUBJECT, MAX_ITEMS, clip, is_test, added_lines

PROPOSITION = ('A test file this change adds or edits makes a real network request to a non-local host '
               '(an external API, a model endpoint, a URL read from the environment) instead of a local stub '
               'server or an injected fake, so the suite depends on the network. Only an executable call site '
               'counts: one the test itself runs or hands to the code under test, such as fetch("https://api.example.com") '
               'or a non-local URL passed as an argument. A site whose network text lies only inside a string literal '
               'that holds source code (fixture source passed as data to a parser, guard or harness, never executed by '
               'the test) is not a network request, however real its URL looks. In the state, VIOLATED is '
               'n_executable_non_local >= 1: a network_call_sites entry with executable_non_local true; an entry with '
               'only_inside_source_literal true never counts.')

CRITERIA = {
    'VIOLATED': 'some executable call site in a changed test reaches a non-local host (n_executable_non_local >= 1)',
    'SATISFIED': 'every executable network call in the changed tests targets a local stub or an injected fake, '
                 'and any other network text is only fixture source inside a string literal (n_executable_non_local == 0)',
    'NOT_APPLICABLE': 'the changed tests list no network call site at all',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('network_call_sites',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'

CALL = re.compile(
    r'\bfetch\s*\(|\baxios\b|\brequests\.(get|post|put|patch|delete|request|Session)\b|\bhttpx\.|urlopen|'
    r'urllib\.request|\bhttps?\.(get|request)\s*\(|new\s+WebSocket|net\.Dial|http\.(Get|Post)\(|'
    r'\bcurl\b|\bwget\b|decisionsCall|https?://|_URL\b|\bendpoint\b')
LOCAL_SERVER = re.compile(
    r'Bun\.serve|createServer|httptest\.|\bnock\b|\bmsw\b|setupServer|responses\.activate|HTTPServer|'
    r'globalThis\.fetch\s*=|vi\.stubGlobal|mockFetch|respx')
HOST = re.compile(r'https?://([^/\s\'"`:)]+)')
LOCAL_HOST = re.compile(r'^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\$\{[^}]*\})$')


# a network call written as code: a literal holding one of these is source text, not a URL value
SRC_CALL = re.compile(
    r'\bfetch\s*\(|\baxios\b|\brequests\.\w+|\bhttpx\.|urlopen|urllib\.request|\bhttps?\.(get|request)\s*\(|'
    r'new\s+WebSocket|net\.Dial|http\.(Get|Post)\(|\b(curl|wget)\s+-')
# a line that runs its literal (a shell command handed to a process) executes it, source text or not
RUNS_LITERAL = re.compile(
    r'\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|system)\s*\(|Bun\.spawn|\$`|subprocess\.|os\.(system|popen)')
# outside a literal these are names (a variable called curl, an endpoint field), not calls
BARE_NAME = re.compile(r'^(curl|wget|endpoint|_URL)$')
JS_EXT = re.compile(r'\.(c|m)?(j|t)sx?$')
PY_EXT = re.compile(r'\.py$')
REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^')


def _js_literals(s):
    """Outermost string/template literal spans [a, b) of JS/TS source; a template's ${...} is inside it."""
    n, spans = len(s), []

    def string(i, q):
        while i < n:
            c = s[i]
            if c == '\\':
                i += 2; continue
            if c == q:
                return i + 1
            if c == '\n':
                return i
            i += 1
        return n

    def template(i):
        while i < n:
            c = s[i]
            if c == '\\':
                i += 2; continue
            if c == '`':
                return i + 1
            if c == '$' and i + 1 < n and s[i + 1] == '{':
                i = code(i + 2, True); continue
            i += 1
        return n

    def regex(i):
        cls = False
        while i < n and s[i] != '\n':
            c = s[i]
            if c == '\\':
                i += 2; continue
            if c == '[':
                cls = True
            elif c == ']':
                cls = False
            elif c == '/' and not cls:
                return i + 1
            i += 1
        return i

    def code(i, nested):
        depth, prev = 0, ''
        while i < n:
            c = s[i]
            if c in '\'"`':
                j = string(i + 1, c) if c != '`' else template(i + 1)
                if not nested:
                    spans.append((i, j))
                i, prev = j, 'x'; continue
            if s.startswith('//', i):
                j = s.find('\n', i); i = n if j < 0 else j; continue
            if s.startswith('/*', i):
                j = s.find('*/', i + 2); i = n if j < 0 else j + 2; continue
            if c == '/' and (prev == '' or prev in REGEX_PREV):
                i, prev = regex(i + 1), 'x'; continue
            if nested and c == '{':
                depth += 1
            elif nested and c == '}':
                if depth == 0:
                    return i + 1
                depth -= 1
            if not c.isspace():
                prev = c
            i += 1
        return n

    code(0, False)
    return spans


def _py_literals(s):
    """String literal spans [a, b) of Python source, triple-quoted ones across lines."""
    n, spans, i = len(s), [], 0
    while i < n:
        c = s[i]
        if c == '#':
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if c in '\'"':
            q = s[i:i + 3] if s[i:i + 3] == c * 3 else c
            j = i + len(q)
            while j < n:
                if s[j] == '\\':
                    j += 2; continue
                if s.startswith(q, j):
                    j += len(q); break
                if len(q) == 1 and s[j] == '\n':
                    break
                j += 1
            spans.append((i, min(j, n)))
            i = j; continue
        i += 1
    return spans


def _literal_spans(label, text):
    name = label[:-len('.fixture')] if label.endswith('.fixture') else label
    if JS_EXT.search(name):
        return _js_literals(text)
    if PY_EXT.search(name):
        return _py_literals(text)
    return None


def _enclosing(spans, a, b):
    lo, hi = 0, len(spans)
    while lo < hi:  # last span starting at or before a
        mid = (lo + hi) // 2
        if spans[mid][0] <= a:
            lo = mid + 1
        else:
            hi = mid
    if lo and spans[lo - 1][0] <= a and b <= spans[lo - 1][1]:
        return spans[lo - 1]
    return None


def evidence(files, plan_lines=None):
    calls, servers, examined, n_lines = [], [], [], 0
    for rel, a in files:
        if not is_test(rel):
            continue
        lines, added = _read(a), added_lines(a)
        if lines is None:
            continue
        examined.append(rel)
        n_lines += len(lines)
        text = '\n'.join(lines)
        spans = _literal_spans(rel, text)
        offset = 0
        for i, t in enumerate(lines):
            n = i + 1
            line_start, offset = offset, offset + len(t) + 1
            if LOCAL_SERVER.search(t):
                servers.append({'file': rel, 'line': n, 'text': clip(t)})
            encl = []
            for m in CALL.finditer(t):
                e = None if spans is None else _enclosing(spans, line_start + m.start(), line_start + m.end())
                if spans is not None and e is None and BARE_NAME.match(m.group(0)):
                    continue
                encl.append(e)
            if not encl:
                continue
            hosts = HOST.findall(t)
            inside = all(e is not None for e in encl)
            source = (inside and not RUNS_LITERAL.search(t)
                      and all(SRC_CALL.search(text[e[0]:e[1]]) for e in encl))
            local = bool(hosts) and all(LOCAL_HOST.match(h) for h in hosts)
            mentions_local = bool(re.search(r'localhost|127\.0\.0\.1|\bport\b', t))
            env = bool(re.search(r'process\.env|os\.environ|getenv|\$\{?[A-Z_]+_URL', t))
            calls.append({'file': rel, 'line': n, 'text': clip(t),
                          'added_by_change': added is not None and n in added,
                          'hosts': hosts,
                          'hosts_all_local': local,
                          'mentions_localhost': mentions_local,
                          'reads_environment': env,
                          'only_inside_string_literal': inside,
                          'only_inside_source_literal': source,
                          'executable_non_local': not source and (
                              (bool(hosts) and not local) or (env and not mentions_local))})
    calls.sort(key=lambda c: (not c['executable_non_local'], c['only_inside_source_literal'],
                              c['hosts_all_local'] or c['mentions_localhost'], not c['added_by_change']))
    inventory = {
        'test_files_examined': examined,
        'network_call_sites': calls[:MAX_ITEMS],
        'n_network_call_sites': len(calls),
        'n_lines_searched': n_lines,
        'n_executable_non_local': sum(c['executable_non_local'] for c in calls),
        'n_only_inside_source_literal': sum(c['only_inside_source_literal'] for c in calls),
        'local_stub_servers_or_fakes': servers[:20],
    }
    return render_json('NET', [(r, a) for r, a in files if is_test(r)], inventory, [])
