#!/usr/bin/env python3
"""Scan the lines a change ADDS (git diff HEAD plus untracked files) for three patterns no reviewer
should have to read for: a focused or skipped test, TLS verification turned off, a committed secret.

Usage: diff-scan.py --project-dir P [--plan X] [--files F ...] (checks/ds/constraints/_contract.py). Reads
only the files given, an untracked or ignored one whole. Prints the count line, then one line per hit; exit 1
on any hit, 0 on none, 2 when it could not run. Paths under fixtures/ and lines carrying `scan: allow` are exempt.
"""
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', '..', 'ds', 'constraints'))
from _contract import count_line, expand, parse, rel  # the contract helper

TEST_PATH = re.compile(r'(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.[a-z]+$|(^|/)test_[^/]*\.py$|_test\.(go|py)$')
CHECKS = [
    ('focused-or-skipped-test', True, re.compile(
        r'\b(?:describe|it|test)\.(?:only|skip)\s*\(|\b(?:xit|xdescribe|fit|fdescribe)\s*\(|@pytest\.mark\.skip\b|\bt\.Skip(?:Now|f)?\s*\(')),
    ('tls-verification-off', False, re.compile(
        r'rejectUnauthorized\s*:\s*false|\bverify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["\']?0|\bcurl\b[^\n]*\s(?:-k|--insecure)\b')),
    ('secret', False, re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b')),
]


def git(root, *a):
    return subprocess.run(['git', '-c', 'core.quotePath=false', '-C', root, *a], capture_output=True, text=True, check=False)


def added(root, wanted):
    """(path, line_no, text) for every line the working tree adds over HEAD in `wanted`, untracked files whole."""
    has_head = git(root, 'rev-parse', '--verify', '-q', 'HEAD').returncode == 0
    if has_head:
        path, n = None, 0
        for ln in git(root, 'diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/').stdout.splitlines():
            if ln.startswith('+++ '):
                path = ln[6:].removesuffix('\t') if ln.startswith('+++ b/') else None  # a spaced name ends in a tab
            elif ln.startswith('@@'):
                m = re.search(r'\+(\d+)', ln)
                n = int(m.group(1)) if m else 0
            elif ln.startswith('+') and path in wanted:
                yield path, n, ln[1:]
                n += 1
    tracked = set(git(root, 'ls-files', '-z').stdout.split('\0')) if has_head else set()
    for path in sorted(wanted - tracked):
        try:
            with open(os.path.join(root, path), encoding='utf-8') as f:
                for i, text in enumerate(f, 1):
                    yield path, i, text.rstrip('\n')
        except (UnicodeDecodeError, OSError):
            continue


def main():
    a = parse()
    proj = os.path.realpath(a.project_dir)
    try:
        files = {os.path.realpath(p) for p in expand(a.files)}
    except FileNotFoundError as e:
        print(f'COULD-NOT-RUN: diff-scan: no file named {e}', file=sys.stderr)
        return 2
    top = git(proj, 'rev-parse', '--show-toplevel')
    if not files or top.returncode != 0:
        print(count_line('diff-scan', 0, 'added line(s)', 'not a git repo' if files else f'no file among {len(a.files)} path(s) given'))
        return 0
    root = os.path.realpath(top.stdout.strip())
    hits, lines, exempt = [], 0, 0
    for path, n, text in added(root, {os.path.relpath(p, root) for p in files}):
        if 'fixtures/' in path or 'scan: allow' in text:
            exempt += 1
            continue
        lines += 1
        for name, tests_only, rx in CHECKS:
            if tests_only and not TEST_PATH.search(path):
                continue
            if rx.search(text):
                hits.append(f'{rel(os.path.join(root, path), proj)}:{n}: {name} {text.strip()[:160]}')
    # The non-vacuity count line (work/scripts/leg-counts.sh); a change that adds nothing is empty scope.
    note = f'{exempt} exempt' if exempt else ''
    print(count_line('diff-scan', lines, 'added line(s)', ', '.join(filter(None, ['no line added over HEAD', note])), note))
    for h in hits:
        print(h)
    return 1 if hits else 0


if __name__ == '__main__':
    sys.exit(main())
