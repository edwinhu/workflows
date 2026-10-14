#!/usr/bin/env python3
"""The non-vacuity convention: every mechanical leg prints a count line of what it examined.

    <leg>: N <unit> examined[ <detail>]

N is what the leg READ (lines, cites, tests, pages, sections), not what it was handed. A leg that had
inputs and examined none exits 2 (COULD-NOT-CHECK). A leg whose scope is empty by construction (no
line added over HEAD, a command the plan did not declare) prints N = 0 with the marker
`nothing in scope (<why>)`, and only that marker excuses a zero. The older forms `N line(s) read` and
`N (CP N) cite(s) checked` still count.

COUNT is the one parser: canary.sh assertion 3, work-checks.sh and the workflows check.sh legs all
read output through this module.

    leg_counts.py audit [--leg NAME] FILE...   exit 2 naming each leg with no count line or a bare zero
    leg_counts.py tests [--re RX] FILE         print `N <runner>` for a test command's output, or nothing
"""
import argparse
import re
import sys

# A COULD-NOT-CHECK line is the audit's own report (it reaches checks.json's tail), never a leg's count line.
COUNT = re.compile(r"^(?!COULD-NOT-CHECK:)(?P<leg>[\w-]+): .*?\b(?P<n>\d+) (?P<unit>[^\d,:\n]+?) "
                   r"(?P<verb>read|checked|examined|scanned)\b(?P<rest>[^\n]*)$", re.M)
NOTHING_IN_SCOPE = 'nothing in scope ('
# A leg's header: the teaching check.sh `=== leg: NAME` and the workflows check.sh `leg NAME exit=N`.
LEG = re.compile(r"^(?:=== leg: (?P<a>[\w-]+)[ \t]*$|leg (?P<b>[\w-]+) exit=)", re.M)
LEG_EXIT = re.compile(r"^leg [\w-]+ exit=(\d+)", re.M)
LEG_CAP = 64        # legs kept per command in checks.json; the rest are counted, not listed
LEG_TEXT_CAP = 240  # chars of a leg's header + count lines kept


def counts(text):
    return [(m['leg'], int(m['n']), m['unit'], m['verb'], m.group(0)) for m in COUNT.finditer(text)]


def legs(text):
    seen = []
    for m in LEG.finditer(text):
        name = m['a'] or m['b']
        if name not in seen:
            seen.append(name)
    return seen


def leg_records(text, cap=LEG_CAP):
    """([{name, exit, examined, unit, text}], omitted): one record per leg from the FULL output, in order.

    exit is the `leg NAME exit=N` verdict (None for a `=== leg:` header); examined/unit total the leg's
    count lines (None when it printed none); text is its header and count lines, clipped. Past `cap`
    legs the rest are only counted in `omitted`.
    """
    recs = {}
    events = [(m.start(), 'leg', m) for m in LEG.finditer(text)] + [(m.start(), 'count', m) for m in COUNT.finditer(text)]
    for _, kind, m in sorted(events, key=lambda e: e[0]):
        if kind == 'leg':
            name = m['a'] or m['b']
            r = recs.setdefault(name, {'name': name, 'exit': None, 'examined': None, 'unit': None, 'lines': []})
            e = LEG_EXIT.match(m.group(0) + text[m.end():m.end() + 20]) if m['b'] else None
            if e and r['exit'] is None:
                r['exit'] = int(e.group(1))
            r['lines'].append(text[m.start():text.find('\n', m.start()) if text.find('\n', m.start()) >= 0 else len(text)].strip())
        else:
            r = recs.setdefault(m['leg'], {'name': m['leg'], 'exit': None, 'examined': None, 'unit': None, 'lines': []})
            r['examined'] = (r['examined'] or 0) + int(m['n'])
            r['unit'] = r['unit'] or m['unit']
            r['lines'].append(m.group(0).strip())
    out = [{**{k: v for k, v in r.items() if k != 'lines'}, 'text': '\n'.join(r['lines'])[:LEG_TEXT_CAP]} for r in recs.values()]
    return out[:cap], max(0, len(out) - cap)


def audit(text, only=None):
    """One failure per leg that printed no count line, and per count line that is a bare zero."""
    fails, have = [], set()
    for leg, n, _, verb, line in counts(text):
        if only and leg != only:
            continue
        have.add(leg)
        if n == 0 and NOTHING_IN_SCOPE not in line:
            fails.append(f'leg {leg} {verb} 0 — vacuous: {line.strip()[:200]}')
    for leg in ([only] if only else legs(text)):
        if leg not in have:
            fails.append(f'leg {leg} printed no count line (`{leg}: N <unit> examined`) — what it examined is unknown')
    return fails


def audit_records(recs):
    """audit() over the leg records work-checks.sh stored from the full output (checks.json `legs`)."""
    fails = []
    for r in recs:
        if r.get('examined') is None:
            fails.append(f"leg {r['name']} printed no count line (`{r['name']}: N <unit> examined`) — what it examined is unknown")
        elif r['examined'] == 0 and NOTHING_IN_SCOPE not in (r.get('text') or ''):
            fails.append(f"leg {r['name']} examined 0 — vacuous: {(r.get('text') or '').strip()[:200]}")
    return fails


# Test-runner summaries, most specific first; each is (runner, regex, how to total the groups).
_RUNNERS = [
    ('bun', re.compile(r'^Ran (\d+) tests? across', re.M), 'first'),
    ('cargo', re.compile(r'^test result: \w+\. (\d+) passed; (\d+) failed', re.M), 'sum'),
    ('jest', re.compile(r'^Tests:\s+.*?(\d+) total', re.M), 'first'),
    ('vitest', re.compile(r'^\s*Tests\s+.*?\((\d+)\)', re.M), 'first'),
    ('node', re.compile(r'^(?:# |ℹ )tests (\d+)', re.M), 'first'),
    ('pytest', re.compile(r'^=*\s*(?:(\d+) failed, )?(\d+) passed', re.M), 'sum'),
    ('pytest', re.compile(r'^=*\s*(\d+) failed\b', re.M), 'first'),
    ('mocha', re.compile(r'^\s*(\d+) passing', re.M), 'first'),
    ('go', re.compile(r'^(?:ok|FAIL)\s+\S+\s+(?:\(cached\)|[\d.]+s)', re.M), 'lines'),
]


def count_tests(text, rx=None):
    """(N, runner) from a test command's output, or None when no summary is recognised."""
    if rx:
        hits = [int(g) for m in re.finditer(rx, text, re.M) for g in m.groups() if g]
        return (sum(hits), 'custom') if hits else None
    for name, pat, how in _RUNNERS:
        ms = list(pat.finditer(text))
        if not ms:
            continue
        if how == 'lines':
            return len(ms), name
        if how == 'first':
            return sum(int(m.group(1)) for m in ms), name
        return sum(int(g) for m in ms for g in m.groups() if g), name
    return None


def _read(paths):
    return '\n'.join(open(p, encoding='utf-8', errors='replace').read() for p in paths)


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or '').split('\n\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('audit')
    a.add_argument('--leg')
    a.add_argument('files', nargs='+')
    t = sub.add_parser('tests')
    t.add_argument('--re')
    t.add_argument('file')
    args = ap.parse_args(argv)
    if args.cmd == 'audit':
        fails = audit(_read(args.files), args.leg)
        for f in fails:
            print(f'COULD-NOT-CHECK: {f}', file=sys.stderr)
        return 2 if fails else 0
    got = count_tests(_read([args.file]), args.re)
    if got:
        print(f'{got[0]} {got[1]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
