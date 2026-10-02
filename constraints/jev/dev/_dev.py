"""Shared extraction for the dev rules: diff hunks, test-file detection, bounded records."""
import os
import re
import subprocess

from _common import _read

SUBJECT = 'one code change (its diff, tests and scripts)'
MAX_ITEMS = 60      # per inventory list; the state must stay well inside rule-check's 60000 chars
TEXT = 240

TEST_PATH = re.compile(
    r'(^|/)(tests?|__tests__|spec)/|[._-](test|spec)\.[A-Za-z]+$|(^|/)test_[^/]*\.py$|_test\.(go|py)$')
TEST_START = re.compile(
    r'^\s*(?:(?:test|it)(?:\.each\([^)]*\))?\s*\(\s*[`\'"]|def\s+test_\w*\s*\(|func\s+Test\w*\s*\()')
ASSERT = re.compile(
    r'\bexpect\s*\(|\bassert\w*\b|\bself\.assert\w+|\bt\.(Error|Fatal)|\.should\b|\bassert_called')

_roots = {}


def _root(abs_path):
    d = os.path.dirname(os.path.abspath(abs_path))
    if d not in _roots:
        r = subprocess.run(['git', '-C', d, 'rev-parse', '--show-toplevel'],
                           capture_output=True, text=True)
        _roots[d] = r.stdout.strip() if r.returncode == 0 else None
    return _roots[d]


def is_test(label):
    return bool(TEST_PATH.search(label))


def clip(s):
    s = s.strip()
    return s if len(s) <= TEXT else s[:TEXT] + '…'


def hunks(abs_path):
    """[{start, removed:[(n,text)], added:[(n,text)]}] against HEAD. An untracked or new file is
    one hunk of all-added lines; a file git cannot see is None."""
    root = _root(abs_path)
    lines = _read(abs_path)
    if root is None or lines is None:
        return None
    rel = os.path.relpath(os.path.abspath(abs_path), root)
    tracked = subprocess.run(['git', '-C', root, 'cat-file', '-e', f'HEAD:{rel}'],
                             capture_output=True).returncode == 0
    if not tracked:
        return [{'start': 1, 'removed': [], 'added': [(i + 1, t) for i, t in enumerate(lines)]}]
    diff = subprocess.run(['git', '-C', root, 'diff', '--no-color', '-U0', 'HEAD', '--', rel],
                          capture_output=True, text=True, errors='replace').stdout
    out, cur, old_n, new_n = [], None, 0, 0
    for ln in diff.splitlines():
        m = re.match(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@', ln)
        if m:
            old_n, new_n = int(m.group(1)), int(m.group(2))
            cur = {'start': new_n, 'removed': [], 'added': []}
            out.append(cur)
        elif cur is None:  # file headers; one file per diff, so nothing follows the first @@
            continue
        elif ln.startswith('-'):
            cur['removed'].append((old_n, ln[1:])); old_n += 1
        elif ln.startswith('+'):
            cur['added'].append((new_n, ln[1:])); new_n += 1
    return out


def added_lines(abs_path):
    hs = hunks(abs_path)
    if hs is None:
        return None
    return {n for h in hs for n, _ in h['added']}


def test_blocks(lines):
    """(start_line, name, end_line) for every test function, by its opening line; a block ends where
    the next one starts."""
    starts = [(i + 1, clip(t)) for i, t in enumerate(lines) if TEST_START.search(t)]
    return [(s, name, (starts[k + 1][0] - 1 if k + 1 < len(starts) else len(lines)))
            for k, (s, name) in enumerate(starts)]


def body(lines, start):
    """1-based line numbers of the indented body under line `start` (indentation, any language)."""
    ind = len(lines[start - 1]) - len(lines[start - 1].lstrip())
    out = []
    for n in range(start + 1, len(lines) + 1):
        t = lines[n - 1]
        if not t.strip():
            continue
        if len(t) - len(t.lstrip()) <= ind:
            break
        out.append(n)
    return out
