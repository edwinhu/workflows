import re
from _common import _search, render_json

PROPOSITION = 'The state runs a specification curve and NO additional robustness check (no placebo, no bootstrap, no leave-one-out, no permutation, no IV or RDD).'

CRITERIA = {
    'VIOLATED': 'a spec curve is present and no additional robustness check is',
    'SATISFIED': 'at least one additional robustness check is present beside the spec curve',
    'NOT_APPLICABLE': 'the state estimates nothing whose robustness could be checked',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    spec = _search(files, r'spec.?curve|specification|variant|VARIANTS|grid|poly_order',
                   'the specification curve / the specifications run')
    extra = _search(files, r'placebo|bootstrap|leave.?one.?out|\bLOO\b|permutation|randomi[sz]|'
                           r'\bIV\b|\bRDD\b|jackknife|winsor|subsample|falsification',
                    'ANY additional robustness check beyond the spec curve')
    return render_json('A1', files, {}, [spec, extra])
