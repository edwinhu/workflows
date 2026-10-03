import re

from _common import render_json
from _econ import MAX_ITEMS, prose_files, scope_note, sentences, span

DELIVERABLE = 'finance or accounting journal'

PROPOSITION = ('A result from a correlational design is stated in causal language: a sentence reporting '
               'the paper\'s own result says X causes, drives, leads to, increases or reduces Y, or names '
               'the "effect" or "impact" of X on Y, while the evidence named for that result is an '
               'association (a cross-sectional or panel regression, a correlation, a sort) with no '
               'identification strategy (instrument, discontinuity, natural experiment, '
               'difference-in-differences around an exogenous shock, randomization) stated for it. '
               'Causal language on an identified estimate, about a mechanism in a model, or about '
               'another paper\'s result is compliant, and so is "associated with"; so is a sentence saying '
               'how a specification change moves an estimate ("adding controls raises the coefficient").')

CRITERIA = {
    'VIOLATED': 'at least one sentence states the paper\'s own correlational result in causal language',
    'SATISFIED': 'every causal claim rests on a stated identification strategy, is hedged to association, '
                 'or concerns a model or another paper',
    'NOT_APPLICABLE': 'the state holds no causal-language sentence about a result',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('causal_language_sentences',)

CAUSAL_RX = (r'\b(?:causes?|caused|causing|causal(?:ly)?|leads? to|led to|drives?|driven by|drove|results? in|'
             r'resulted in|effect of|effects of|impact of|impacts|increases|increased|reduces|reduced(?!-form)|'
             r'raises|raised|lowers|lowered|boosts|boosted|depress(?:es|ed)|because of|as a result of)\b')
RESULT_RX = re.compile(r'\b(?:we|our|this paper|the paper|results?|estimates?|coefficients?|evidence|find|'
                       r'findings?|regression|sample|firms?|funds?|investors?)\b', re.IGNORECASE)
# a specification change moving an estimate ("adding controls raises the coefficient") is arithmetic, not a claim
SPEC_RX = re.compile(r'\b(?:rais|reduc|increas|lower|lift|cut|chang|mov|shrink|doubl|halv)\w*\s+(?:[\w-]+\s+){0,4}?'
                     r'(?:coefficients?|estimates?|standard errors?|R-?squared|R2|counts?|sample|contrast|first[- ]stage|'
                     r'second[- ]stage|t-stat\w*|point estimate|magnitude)\b', re.IGNORECASE)
DESIGN_RX = (r'\b(?:first[- ]stage|second[- ]stage|just-identified|over-identified|reconstitution|bandwidth|cutoff|'
             r'instrument(?:al)?(?: variables?)?|IV|2SLS|two-stage least squares|regression discontinuity|'
             r'RDD?|natural experiment|quasi-experiment(?:al)?|difference-in-differences?|diff-in-diff|DiD|'
             r'exogenous(?:ly)?|shock|randomi[sz]ed|random assignment|placebo|event study|staggered|'
             r'synthetic control|identif(?:y|ies|ied|ication)|endogene?ity|reverse causality|omitted variables?|'
             r'correlat(?:ion|ional|ed)|associat(?:ed|ion)|OLS|cross-sectional|panel regression|fixed effects)\b')


def evidence(files, plan_lines=None, changed=None):
    crx, drx = re.compile(CAUSAL_RX, re.IGNORECASE), re.compile(DESIGN_RX)
    cands, design, n_all = [], {}, 0
    for s in sentences(files, changed):
        for m in drx.finditer(s['sentence']):
            design.setdefault(m.group(0).lower(), []).append(f"{s['file']}:{s['line']}")
        bare = SPEC_RX.sub(' ', s['sentence'])
        if crx.search(bare) and RESULT_RX.search(s['sentence']):
            n_all += 1
            if s['in_scope']:
                cands.append({**span(s), 'causal_words': sorted({m.group(0).lower() for m in crx.finditer(bare)})})
    inventory = {
        'causal_language_sentences': cands[:MAX_ITEMS],
        'n_causal_language_sentences_listed': len(cands),
        'n_causal_language_sentences_in_files': n_all,
        'design_and_identification_terms_in_the_document': {k: {'n': len(v), 'where': v[:4]}
                                                            for k, v in sorted(design.items())},
        'note': ('design terms are searched in the whole document, not only the changed lines; an '
                 'empty map means no identification or design language appears anywhere'),
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('E-CAUSAL', prose_files(files), inventory, [])
