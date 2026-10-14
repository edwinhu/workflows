"""What THIS run changed: the one scope helper for every check that judges "added lines" or "changed files".

With WORK_RUN_BASELINE set to a valid tree sha (work-checks.sh exports it; skills/work/scripts/tree-snapshot.sh made
it at dispatch), the scope is that tree against a fresh snapshot of now, so uncommitted work already there when the run
began is out of scope. Without it the scope is the working tree against HEAD plus untracked files, as before.
Mirrors rule-check.ts changedFiles/changedRanges (`since`).
"""
import os
import re
import subprocess

_SNAPSHOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', '..', 'skills', 'work', 'scripts', 'tree-snapshot.sh')
_SHA = re.compile(r'[0-9a-f]{40,64}')


def _git(root, *a):
    return subprocess.run(['git', '-c', 'core.quotePath=false', '-C', root, *a], capture_output=True, text=True, errors='replace', check=False)


def baseline(since=None):
    """The baseline tree to scope by: `since` or $WORK_RUN_BASELINE when it is a tree sha, else None (scope by HEAD)."""
    b = since or os.environ.get('WORK_RUN_BASELINE') or ''
    return b if _SHA.fullmatch(b) else None


def _now_tree(root):
    r = subprocess.run(['bash', _SNAPSHOT, root], capture_output=True, text=True, check=False)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def _since_tree(root, since):
    """(baseline, tree of now) when a baseline applies and git can snapshot, else None."""
    b = baseline(since)
    now = _now_tree(root) if b else None
    return (b, now) if now else None


def changed_files(project, since=None):
    """Paths relative to `project` of the changed and untracked files under it, or None when it is no git tree."""
    top = _git(project, 'rev-parse', '--show-toplevel')
    if top.returncode != 0:
        return None
    tr = _since_tree(project, since)
    if tr:
        r = _git(project, 'diff', '--name-only', '--relative', '--diff-filter=d', tr[0], tr[1], '--', '.')
        return [n for n in r.stdout.split('\n') if n]
    names = _git(project, 'diff', '--name-only', '--relative', 'HEAD', '--', '.').stdout.split('\n') + \
        _git(project, 'ls-files', '--others', '--exclude-standard').stdout.split('\n')
    return [n for n in names if n]


def added_lines(root, wanted=None, since=None):
    """(path, line_no, text) for every line added in `wanted` (paths relative to the repo top `root`; None = all).
    A file outside the scope's tree (untracked under HEAD scope, ignored under either) counts whole."""
    tr = _since_tree(root, since)
    ref = ['diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']
    if tr:
        ref += [tr[0], tr[1]]
        known = set(_git(root, 'ls-tree', '-r', '--name-only', '-z', tr[1]).stdout.split('\0'))
    elif _git(root, 'rev-parse', '--verify', '-q', 'HEAD').returncode == 0:
        ref += ['HEAD']
        known = set(_git(root, 'ls-files', '-z').stdout.split('\0'))
    else:
        ref, known = None, set()
    if ref:
        path, n = None, 0
        for ln in _git(root, *ref).stdout.splitlines():
            if ln.startswith('+++ '):
                path = ln[6:].removesuffix('\t') if ln.startswith('+++ b/') else None  # a spaced name ends in a tab
            elif ln.startswith('@@'):
                m = re.search(r'\+(\d+)', ln)
                n = int(m.group(1)) if m else 0
            elif ln.startswith('+') and path is not None and (wanted is None or path in wanted):
                yield path, n, ln[1:]
                n += 1
    whole = sorted((wanted or set()) - known) if wanted is not None else \
        [p for p in _git(root, 'ls-files', '--others', '--exclude-standard', '-z').stdout.split('\0') if p and p not in known]
    for path in whole:
        try:
            with open(os.path.join(root, path), encoding='utf-8') as f:
                for i, text in enumerate(f, 1):
                    yield path, i, text.rstrip('\n')
        except (UnicodeDecodeError, OSError):
            continue
