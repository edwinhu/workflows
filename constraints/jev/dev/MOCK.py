import re
from _common import _read, render_json
from _dev import SUBJECT, MAX_ITEMS, ASSERT, clip, is_test, added_lines, test_blocks

PROPOSITION = ('At least one test that this change adds or edits has NO assertion on a return value, output or '
               'state of the code under test: every one of its assertions inspects a test double (how often a mock, '
               'stub or spy was called, or with what arguments). In the state, that is a changed test with '
               'every_assertion_on_mock true.')

CRITERIA = {
    'VIOLATED': 'some changed test asserts only on mocks/spies, never on a real result',
    'SATISFIED': 'every changed test asserts on at least one real result of the code under test',
    'NOT_APPLICABLE': 'the change adds or edits no test',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('changed_tests',)

MOCK_MATCHER = re.compile(
    r'toHaveBeenCalled\w*|toBeCalled\w*|toHaveBeenNthCalledWith|\.mock\.(calls|results)|'
    r'assert_(called|any_call|has_calls|not_called)\w*|call_count|called_with|\.called\b|'
    r'-mock[\'"]|\bmock\w*\b|\bspy\w*\b|\bstub\w*\b', re.I)
DOUBLE = re.compile(
    r'(\w+)\s*=\s*(?:vi|jest)\.(?:fn|spyOn)\b|(\w+)\s*=\s*(?:\w+\.)?(?:Mock|MagicMock|AsyncMock|create_autospec)\(|'
    r'(\w+)\s*=\s*sinon\.(?:stub|spy|fake)|\bas\s+(\w+)\s*:\s*$|(\w+)\s*=\s*mocker\.(?:patch|spy)')


def evidence(files, plan_lines=None):
    tests, examined, untouched = [], [], 0
    for rel, a in files:
        if not is_test(rel):
            continue
        lines, added = _read(a), added_lines(a)
        if lines is None:
            continue
        examined.append(rel)
        doubles = {g for m in DOUBLE.finditer('\n'.join(lines)) for g in m.groups() if g}
        dbl = re.compile(r'\b(' + '|'.join(map(re.escape, sorted(doubles))) + r')\b') if doubles else None
        for start, name, end in test_blocks(lines):
            span = range(start, end + 1)
            if added is not None and not any(n in added for n in span):
                untouched += 1
                continue
            asserts = []
            for n in span:
                t = lines[n - 1]
                if ASSERT.search(t):
                    on_mock = bool(MOCK_MATCHER.search(t) or (dbl and dbl.search(t)))
                    asserts.append({'line': n, 'text': clip(t), 'on_mock': on_mock})
            tests.append({'file': rel, 'line': start, 'test': name,
                          'new': added is not None and start in added,
                          'n_assertions': len(asserts),
                          'n_on_mock': sum(x['on_mock'] for x in asserts),
                          'every_assertion_on_mock': bool(asserts) and all(x['on_mock'] for x in asserts),
                          'assertions': asserts[:12]})
    tests.sort(key=lambda t: (not t['every_assertion_on_mock'], not t['new']))
    inventory = {
        'test_files_examined': examined,
        'test_doubles_note': 'on_mock = the assertion names a mock matcher or a variable bound to a test double',
        'changed_tests': tests[:MAX_ITEMS],
        'n_changed_tests': len(tests),
        'n_changed_tests_asserting_only_on_mocks': sum(t['every_assertion_on_mock'] for t in tests),
        'n_untouched_tests_skipped': untouched,
    }
    return render_json('MOCK', files, inventory, [])
