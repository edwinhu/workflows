#!/usr/bin/env python3
"""Scan the lines a change ADDS (git diff HEAD plus untracked files) for three patterns no reviewer
should have to read for: a focused or skipped test, TLS verification turned off, a committed secret.

Usage: diff-scan.py <project-dir>. Prints one line per hit; exit 1 on any hit, 0 on none, 3 when the
directory is not a git work tree. Paths under fixtures/ and lines carrying `scan: allow` are exempt.
"""
import os
import re
import subprocess
import sys

TEST_PATH = re.compile(r'(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.[a-z]+$|(^|/)test_[^/]*\.py$|_test\.(go|py)$')
CHECKS = [
    ('focused-or-skipped-test', True, re.compile(
        r'\b(?:describe|it|test)\.(?:only|skip)\s*\(|\b(?:xit|xdescribe|fit|fdescribe)\s*\(|@pytest\.mark\.skip\b|\bt\.Skip(?:Now|f)?\s*\(')),
    ('tls-verification-off', False, re.compile(
        r'rejectUnauthorized\s*:\s*false|\bverify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["\']?0|\bcurl\b[^\n]*\s(?:-k|--insecure)\b')),
    ('secret', False, re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b')),
]


def git(root, *a):
    return subprocess.run(['git', '-C', root, *a], capture_output=True, text=True, check=False)


def added(root):
    """(path, line_no, text) for every line the working tree adds over HEAD, untracked files whole."""
    has_head = git(root, 'rev-parse', '--verify', '-q', 'HEAD').returncode == 0
    if has_head:
        path, n = None, 0
        for ln in git(root, 'diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/').stdout.splitlines():
            if ln.startswith('+++ '):
                path = ln[6:] if ln.startswith('+++ b/') else None
            elif ln.startswith('@@'):
                m = re.search(r'\+(\d+)', ln)
                n = int(m.group(1)) if m else 0
            elif ln.startswith('+') and path:
                yield path, n, ln[1:]
                n += 1
    tracked_new = [] if has_head else git(root, 'ls-files').stdout.splitlines()
    for path in git(root, 'ls-files', '--others', '--exclude-standard').stdout.splitlines() + tracked_new:
        try:
            with open(os.path.join(root, path), encoding='utf-8') as f:
                for i, text in enumerate(f, 1):
                    yield path, i, text.rstrip('\n')
        except (UnicodeDecodeError, OSError):
            continue


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    if git(root, 'rev-parse', '--is-inside-work-tree').returncode != 0:
        print('scan: 0 added line(s) examined — nothing in scope (not a git repo)', file=sys.stderr)
        return 3
    hits = lines = 0
    for path, n, text in added(root):
        if 'fixtures/' in path or 'scan: allow' in text:
            continue
        lines += 1
        for name, tests_only, rx in CHECKS:
            if tests_only and not TEST_PATH.search(path):
                continue
            if rx.search(text):
                print(f'{name}: {path}:{n}: {text.strip()[:160]}', file=sys.stderr)
                hits += 1
    # The non-vacuity count line (work/scripts/leg-counts.sh); a change that adds nothing is empty scope.
    print(f'scan: {lines} added line(s) examined'
          + ('' if lines else ' — nothing in scope (no line added over HEAD)'), file=sys.stderr)
    return 1 if hits else 0


if __name__ == '__main__':
    sys.exit(main())
