#!/usr/bin/env bash
# work-checks.sh — run every command a work round's gate reads, in parallel, after the agents return.
#
#   work-checks.sh ARGS RAW OUT
#
# ARGS  the staged args (projectDir, tasks, redSuiteHashes from work-dispatch.sh)
# RAW   the AGENTS stage's output (farm.sh --workflow --out), whose checkPlan names the commands
# OUT   {red:[{id,command,exitCode,output}], acceptance:[…], mechanical:[{name,cmd,exitCode,output}],
#        suite:{checked, changed:[{path,before,after,owner}]}}
#
# A command that cannot run — timeout, cannot spawn, exit 126/127 — records exitCode -1, which the
# gate reads as unproven, never as a pass. Output keeps the LAST 60 lines: the evidence is at the end.
# A red-suite file whose sha256 differs from the dispatcher's is a change owned by the task whose
# writablePaths reach it, else by 'plan'. WORK_CHECK_TIMEOUT (seconds, default 1800) bounds each command.
set -euo pipefail

[[ $# -eq 3 ]] || { echo "usage: work-checks.sh ARGS RAW OUT" >&2; exit 2; }

python3 - "$1" "$2" "$3" <<'PY'
import hashlib, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

args_path, raw_path, out_path = sys.argv[1:4]
args = json.load(open(args_path))
raw = json.load(open(raw_path))
if not isinstance(raw, dict) or raw.get('stage') != 'agents' or not isinstance(raw.get('checkPlan'), dict):
    sys.exit(f'work-checks: {raw_path} is not an agents-stage result with a checkPlan')
plan = raw['checkPlan']
cwd = args.get('projectDir') or os.getcwd()
timeout = int(os.environ.get('WORK_CHECK_TIMEOUT', '1800'))
TAIL = 60

def tail(s):
    return '\n'.join(s.splitlines()[-TAIL:])

def run(cmd):
    try:
        p = subprocess.run(['bash', '-c', cmd], cwd=cwd, capture_output=True, text=True,
                           errors='replace', timeout=timeout)
    except subprocess.TimeoutExpired:
        return -1, f'could not run: timed out after {timeout}s: {cmd}'
    except OSError as e:
        return -1, f'could not run: {e}: {cmd}'
    out = tail((p.stdout or '') + (p.stderr or ''))
    if p.returncode in (126, 127):
        return -1, f'could not run (exit {p.returncode}): {cmd}\n{out}'
    return p.returncode, out

jobs = [('red', r['id'], r['command']) for r in plan.get('red') or []] \
     + [('acceptance', r['id'], r['command']) for r in plan.get('acceptance') or []] \
     + [('mechanical', r['name'], r['cmd']) for r in plan.get('mechanical') or []]
with ThreadPoolExecutor(max_workers=max(1, min(8, len(jobs)))) as ex:
    results = list(ex.map(lambda j: run(j[2]), jobs))

out = {'red': [], 'acceptance': [], 'mechanical': []}
for (kind, key, cmd), (code, text) in zip(jobs, results):
    if kind == 'mechanical':
        out[kind].append({'name': key, 'cmd': cmd, 'exitCode': code, 'output': text})
    else:
        out[kind].append({'id': key, 'command': cmd, 'exitCode': code, 'output': text})

# Ownership mirrors work-stage.mjs `covers`: a glob, or the path itself, or a directory prefix.
norm = lambda p: re.sub(r'/+$', '', re.sub(r'^\./', '', str(p or '')))
def glob_re(g):
    parts = [ '[^/]*'.join(re.escape(x) for x in seg.split('*')) for seg in norm(g).split('**') ]
    return re.compile('^' + '.*'.join(parts) + '(/.*)?$')
def covers(paths, f):
    f = norm(f)
    return any(glob_re(w).match(f) if '*' in w else (f == norm(w) or f.startswith(norm(w) + '/')) for w in paths or [])
def owner(f):
    rel = os.path.relpath(f, cwd) if os.path.isabs(f) else f
    for t in args.get('tasks') or []:
        if covers(t.get('writablePaths'), rel):
            return t['id']
    return 'plan'
def sha(f):
    p = f if os.path.isabs(f) else os.path.join(cwd, f)
    try:
        with open(p, 'rb') as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None

hashes = args.get('redSuiteHashes') or {}
changed = []
for path, before in sorted(hashes.items()):
    after = sha(path)
    if after != before:
        changed.append({'path': path, 'before': before, 'after': after, 'owner': owner(path)})
out['suite'] = {'checked': len(hashes), 'changed': changed}

with open(out_path, 'w') as fh:
    json.dump(out, fh, indent=2)
    fh.write('\n')
bad = [f"{k}:{r.get('id') or r.get('name')}={r['exitCode']}" for k in ('red', 'acceptance', 'mechanical') for r in out[k] if r['exitCode'] != 0]
print(f"work-checks: {len(jobs)} command(s), {len(bad)} non-zero{(' (' + ', '.join(bad) + ')') if bad else ''}; "
      f"red suite {len(hashes)} file(s), {len(changed)} changed -> {out_path}")
PY
