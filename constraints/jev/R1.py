import re
from _common import _search, render_json

PROPOSITION = 'The state does NOT record the vintage of what it read -- no pull timestamp, as-of date, source mtime, content hash or commit that a re-run could be compared against.'

CRITERIA = {
    'VIOLATED': 'no vintage of any kind is recorded for the data read',
    'SATISFIED': 'a pull time, as-of date, source mtime, hash or commit is recorded',
    'NOT_APPLICABLE': 'the state reads no external data whose vintage could be recorded',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}

VINT_RX = (r'pulled_utc|written_utc|mtime_utc|as[_ ]of|as of|retrieved|query_date|'
           r'vintage|sha256|\bmd5\b|commit|\bsha\b|source_path|generated|timestamp|'
           r'\butc\b|datetime\.now|date\.today')

def evidence(files, plan_lines=None):
    v = _search(files, VINT_RX, 'every recorded vintage: pull time, source mtime, hash, commit',
                window=0)
    rerun = _search(files, r'--refresh|cache|re-?run|idempot|overwrite|deterministic|seed',
                    'whether a re-run is defined to reproduce the same bytes')
    return render_json('R1', files, {}, [v, rerun])
