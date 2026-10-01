import re
from _common import _search, render_json

PROPOSITION = 'A transform in the state changes the data WITHOUT its shape or size being printed on both sides of the change.'

CRITERIA = {
    'VIOLATED': 'a transform has no before/after shape or size printed',
    'SATISFIED': 'every transform prints its shape or size before and after',
    'NOT_APPLICABLE': 'the state performs no transform',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    s = _search(files, r'\[shape\]|\[write\]|\[load\]|\[join\]|\.shape\b|\.height\b|'
                       r'print\(.*rows|md5|snapshot', 'shape/size printed at a transform',
                window=1)
    ba = _search(files, r'\bbefore\b|\bafter\b|pre-|post-|expected|observed|unchanged',
                 'an explicit BEFORE/AFTER comparison')
    return render_json('DQ6', files, {}, [s, ba])
