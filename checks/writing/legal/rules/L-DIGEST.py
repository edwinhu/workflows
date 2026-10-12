import re

from _common import render_json
from _scholar import MAX_ITEMS, clip, load, prose_files, scope_note, touches

DELIVERABLE = 'law review'

PROPOSITION = ('The prose digests precedent case by case instead of synthesizing it: two or more '
               'consecutive paragraphs each recount one decision (its facts, holding or reasoning) in '
               'turn, and no sentence in or around the run states the rule, pattern or tension the cases '
               'establish together ("Courts generally hold X, except when Y"). A run that opens or closes '
               'on such a synthesis, or a single case discussed at length because the argument turns on '
               'it, is compliant.')

CRITERIA = {
    'VIOLATED': 'at least one run of case-by-case paragraphs carries no synthesizing sentence',
    'SATISFIED': 'every run of case paragraphs is framed by a sentence stating what the cases establish '
                 'together, or no run recounts cases one at a time',
    'NOT_APPLICABLE': 'the state holds no paragraph that recounts a decision',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('runs_of_case_paragraphs',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_sentences_searched'

CASE_RX = re.compile(r"\b(?:In re|Ex parte)\s+[A-Z][\w.'&-]+|\b[A-Z][\w.'&-]*(?:\s+[A-Z&][\w.'&-]*){0,5}\s+v\.\s+"
                     r"[A-Z][\w.'&-]*|\b(?:the|The)\s+(?:court|Court|panel|Chancellor|Vice Chancellor)\s+"
                     r"(?:held|found|reasoned|concluded|ruled|rejected|explained)\b")


def _case_para(p):
    first = ' '.join(s[2] for s in p['sentences'][:2])
    return bool(CASE_RX.search(first))


def evidence(files, plan_lines=None, changed=None):
    runs, n_case_paras = [], 0
    docs = load(files)
    for doc in docs:
        paras = [p for p in doc['paras'] if p['kind'] == 'para']
        k = 0
        while k < len(paras):
            if not _case_para(paras[k]):
                k += 1
                continue
            j = k
            while j + 1 < len(paras) and _case_para(paras[j + 1]):
                j += 1
            n_case_paras += j - k + 1
            lo, hi = paras[k]['line'], paras[j]['sentences'][-1][1]
            if j > k and touches(changed, doc['file'], lo, hi):
                runs.append({
                    'file': doc['file'], 'line': lo, 'end_line': hi, 'n_paragraphs': j - k + 1,
                    'paragraph_before': (clip(' '.join(x[2] for x in paras[k - 1]['sentences']), 700)
                                         if k else None),
                    'paragraphs': [{'line': p['line'],
                                    'cases_named': sorted({m.group(0) for s in p['sentences']
                                                              for m in CASE_RX.finditer(s[2])})[:6],
                                    'text': clip(' '.join(x[2] for x in p['sentences']), 700)}
                                   for p in paras[k:j + 1]][:8],
                    'paragraph_after': (clip(' '.join(x[2] for x in paras[j + 1]['sentences']), 700)
                                        if j + 1 < len(paras) else None),
                })
            k = j + 1
    inventory = {
        'n_sentences_searched': sum(len(p['sentences']) for d in docs for p in d['paras']),
        'runs_of_case_paragraphs': runs[:MAX_ITEMS],
        'n_runs': len(runs),
        'n_paragraphs_opening_on_a_case': n_case_paras,
        'selection': ('a case paragraph names a decision ("X v. Y", "In re X") or what a court held in its '
                      'first two sentences; a run is two or more of them in a row'),
    }
    if scope_note(changed):
        inventory['diff_scope_note'] = scope_note(changed)
    return render_json('L-DIGEST', prose_files(files), inventory, [])
