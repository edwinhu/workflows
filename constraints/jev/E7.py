import re
from _common import _search, render_json

PROPOSITION = 'Code in the state fetches from a host it does not own WITHOUT all three of: the effective request rate computed, a documented ceiling to compare it against, and the fallback or retry path shown to have run.'

CRITERIA = {
    'VIOLATED': 'a fetch is present and at least one of the three facts is missing',
    'SATISFIED': 'all three facts are present in the code',
    'NOT_APPLICABLE': 'the state contains no code that fetches from a host it does not own',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

def evidence(files, plan_lines=None):
    rate = _search(files, r'req/s|requests? per second|EFFECTIVE_RPS|rps\b|rate.?limit|'
                          r'calls?/s|connections?/s|sleep\(|spacing', 'THE RATE, computed')
    ceil = _search(files, r'ceiling|documented|publishes|per-user|slots=|quota|limit of|'
                          r'read 20\d\d-\d\d-\d\d', 'THE CEILING it is measured against')
    kind = _search(files, r'quota|rate limit|rate-limit|concurrency cap|not a quota|'
                          r'not a rate limit', 'THE LIMIT KIND determination (quota vs rate)')
    fb = _search(files, r'fallback|retry|attempt|backoff|except|recover',
                 'THE FALLBACK and whether it ran')
    conc = _search(files, r'ThreadPool|ProcessPool|max_workers|N_CHUNKS|asyncio|Pool\(|n_jobs',
                   'the concurrency primitive, if any')
                   
    return render_json('E7', files, {}, [rate, ceil, kind, fb, conc])
