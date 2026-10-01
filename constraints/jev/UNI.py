import re
from _common import _search, render_json

PROPOSITION = 'The same universe predicate is applied INDEPENDENTLY in more than one place in the state -- restated locally rather than taken from one definition -- so two legs can admit different entities.'

CRITERIA = {
    'VIOLATED': 'a universe predicate is restated locally beside a shared one',
    'SATISFIED': 'every leg filters on the one shared universe definition',
    'NOT_APPLICABLE': 'the state applies no universe predicate',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    u = _search(files, r'\.is_?in\(|\.filter\(|universe|permno|\bcik\b|cusip8|gvkey|wficn|'
                       r'entity|accession', 'every site that applies an entity predicate',
                window=1)
    dup = _search(files, r'_here\b|_LOCAL|_local\b|restated|by hand|kept in step|independently',
                  'signs that a predicate is RESTATED rather than shared')
    return render_json('UNI', files, {}, [u, dup])
