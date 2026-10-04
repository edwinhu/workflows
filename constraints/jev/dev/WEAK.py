from _common import _read, render_json
from _dev import SUBJECT, MAX_ITEMS, ASSERT, clip, is_test, hunks, scope

PROPOSITION = ('The change weakens an existing test assertion: a diff hunk in a test file deletes an assertion '
               'without an equally strict replacement, or replaces it with a looser one (exact value to '
               'truthy/defined/contains/greater-than, a widened tolerance or regex, a narrower set of fields '
               'checked, or an assertion wrapped so it can no longer fail).')

CRITERIA = {
    'VIOLATED': 'an assertion was removed or loosened with no equally strict replacement',
    'SATISFIED': 'every changed assertion is kept at least as strict (or tightened, or only added)',
    'NOT_APPLICABLE': 'no diff hunk in a test file removes or rewrites an assertion',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = (('hunks_removing_or_rewriting_assertions', 'file', 'new_line'),)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_test_lines_diffed'


def evidence(files, plan_lines=None, changed=None):
    out, examined, n_rem, n_add, n_lines = [], [], 0, 0, 0
    for rel, a in files:
        if not is_test(rel):
            continue
        hs = hunks(a, scope(changed, rel))
        if hs is None:
            continue
        examined.append(rel)
        n_lines += len(_read(a) or [])
        for h in hs:
            rem = [(n, t) for n, t in h['removed'] if ASSERT.search(t)]
            if not rem:
                continue  # a hunk that only adds assertions cannot weaken one
            n_rem += len(rem)
            add = [(n, t) for n, t in h['added'] if ASSERT.search(t)]
            n_add += len(add)
            out.append({'file': rel, 'new_line': h['start'],
                        'removed_lines': [{'old_line': n, 'text': clip(t)} for n, t in h['removed'][:15]],
                        'added_lines': [{'line': n, 'text': clip(t)} for n, t in h['added'][:15]],
                        'n_assertions_removed': len(rem), 'n_assertions_added': len(add)})
    inventory = {
        'test_files_examined': examined,
        'hunks_removing_or_rewriting_assertions': out[:MAX_ITEMS],
        'n_such_hunks': len(out),
        'n_test_lines_diffed': n_lines,
        'n_assertion_lines_removed': n_rem,
        'n_assertion_lines_added_in_those_hunks': n_add,
    }
    return render_json('WEAK', [(r, a) for r, a in files if is_test(r)], inventory, [])
