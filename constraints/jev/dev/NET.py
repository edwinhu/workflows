import re
from _common import _read, render_json
from _dev import SUBJECT, MAX_ITEMS, clip, is_test, added_lines

PROPOSITION = ('A test file this change adds or edits can make a real network request to a non-local host '
               '(an external API, a model endpoint, a URL read from the environment) instead of a local stub '
               'server or an injected fake, so the suite depends on the network.')

CRITERIA = {
    'VIOLATED': 'a changed test file can reach a non-local host over the network',
    'SATISFIED': 'every network call in the changed tests targets a local stub or an injected fake',
    'NOT_APPLICABLE': 'the changed tests make no network call',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('network_call_sites',)

CALL = re.compile(
    r'\bfetch\s*\(|\baxios\b|\brequests\.(get|post|put|patch|delete|request|Session)\b|\bhttpx\.|urlopen|'
    r'urllib\.request|\bhttps?\.(get|request)\s*\(|new\s+WebSocket|net\.Dial|http\.(Get|Post)\(|'
    r'\bcurl\b|\bwget\b|decisionsCall|https?://|_URL\b|\bendpoint\b')
LOCAL_SERVER = re.compile(
    r'Bun\.serve|createServer|httptest\.|\bnock\b|\bmsw\b|setupServer|responses\.activate|HTTPServer|'
    r'globalThis\.fetch\s*=|vi\.stubGlobal|mockFetch|respx')
HOST = re.compile(r'https?://([^/\s\'"`:)]+)')
LOCAL_HOST = re.compile(r'^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\$\{[^}]*\})$')


def evidence(files, plan_lines=None):
    calls, servers, examined = [], [], []
    for rel, a in files:
        if not is_test(rel):
            continue
        lines, added = _read(a), added_lines(a)
        if lines is None:
            continue
        examined.append(rel)
        for i, t in enumerate(lines):
            n = i + 1
            if LOCAL_SERVER.search(t):
                servers.append({'file': rel, 'line': n, 'text': clip(t)})
            if CALL.search(t):
                hosts = HOST.findall(t)
                calls.append({'file': rel, 'line': n, 'text': clip(t),
                              'added_by_change': added is not None and n in added,
                              'hosts': hosts,
                              'hosts_all_local': bool(hosts) and all(LOCAL_HOST.match(h) for h in hosts),
                              'mentions_localhost': bool(re.search(r'localhost|127\.0\.0\.1|\bport\b', t)),
                              'reads_environment': bool(re.search(r'process\.env|os\.environ|getenv|\$\{?[A-Z_]+_URL', t))})
    calls.sort(key=lambda c: (c['hosts_all_local'] or c['mentions_localhost'], not c['added_by_change']))
    inventory = {
        'test_files_examined': examined,
        'network_call_sites': calls[:MAX_ITEMS],
        'n_network_call_sites': len(calls),
        'n_with_a_non_local_host': sum(bool(c['hosts']) and not c['hosts_all_local'] for c in calls),
        'local_stub_servers_or_fakes': servers[:20],
    }
    return render_json('NET', files, inventory, [])
