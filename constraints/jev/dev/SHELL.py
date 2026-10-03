import re
from _common import _read, render_json
from _dev import SUBJECT, MAX_ITEMS, clip, added_lines

PROPOSITION = ('The change builds a shell command STRING by interpolating a value that is not a constant in '
               'the source (a plan or args field, a task id, a path, a file name, user or model output) and runs '
               'it through a shell (exec/execSync, bash -c, shell=True, os.system, eval), where the value '
               'could carry shell metacharacters; passing the value as its own argv element is the safe form.')

CRITERIA = {
    'VIOLATED': 'a non-constant value is interpolated into a string a shell executes',
    'SATISFIED': 'every shell run in the change uses argv form or only constant/quoted-safe strings',
    'NOT_APPLICABLE': 'the change adds no code that runs a shell or a subprocess',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('added_shell_or_subprocess_sites',)

SINK = re.compile(
    r'\bexecSync\s*\(|\bexec\s*\(|\bexecFile(Sync)?\s*\(|\bspawn(Sync)?\s*\(|\$`|'
    r'[\'"](ba)?sh[\'"]\s*,\s*\[?\s*[\'"]-c|shell\s*[:=]\s*(True|true)|os\.system\s*\(|os\.popen|'
    r'\b(ba)?sh\s+-c\b|^\s*eval\b|[;&|]\s*eval\b|\bsubprocess\.\w+\(')
INTERP = re.compile(r'\$\{|\bf[\'"]|[\'"`]\s*\+\s*\w|\w\s*\+\s*[\'"`]|%s|%\(|\.format\(|"\$\w|\$\(|\$[A-Za-z_]')
ARGV = re.compile(r'\b(spawn|spawnSync|execFile|execFileSync)\s*\(\s*[\'"][\w./-]+[\'"]\s*,\s*\[|subprocess\.\w+\(\s*\[')


def evidence(files, plan_lines=None):
    sinks, examined = [], []
    for rel, a in files:
        lines, added = _read(a), added_lines(a)
        if lines is None:
            continue
        examined.append(rel)
        for i, t in enumerate(lines):
            n = i + 1
            if added is not None and n not in added:
                continue  # pre-existing code is not this change
            if not SINK.search(t):
                continue
            lo, hi = max(1, n - 3), min(len(lines), n + 3)
            ctx = [f'{k}| {clip(lines[k - 1])}' for k in range(lo, hi + 1)]
            sinks.append({'file': rel, 'line': n, 'text': clip(t),
                          'interpolates_on_line': bool(INTERP.search(t)),
                          'argv_form': bool(ARGV.search(t)),
                          'context': ctx})
    sinks.sort(key=lambda s: (s['argv_form'], not s['interpolates_on_line']))
    inventory = {
        'files_examined': examined,
        'added_shell_or_subprocess_sites': sinks[:MAX_ITEMS],
        'n_sites': len(sinks),
        'n_sites_interpolating_on_the_line': sum(s['interpolates_on_line'] for s in sinks),
    }
    return render_json('SHELL', files, inventory, [])
