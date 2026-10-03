#!/usr/bin/env bash
# work-checks.sh — run every command a work round's gate reads, in parallel, after the agents return.
#
#   work-checks.sh ARGS RAW OUT
#
# ARGS  the staged args (projectDir, tasks, redSuiteHashes from work-dispatch.sh)
# RAW   the AGENTS stage's output (farm.sh --workflow --out), whose checkPlan names the commands
# OUT   {red:[{id,command,exitCode,output}], acceptance:[…], mechanical:[{name,cmd,exitCode,output}],
#        rules:[{name,cmd,exitCode,stdout,output}], suite:{checked, changed:[{path,before,after,owner}]}}
#
# A command that cannot run — timeout, cannot spawn, exit 126/127 — records exitCode -1, which the
# gate reads as unproven, never as a pass. Output keeps the LAST 60 lines: the evidence is at the end.
# A rule check's stdout is its last non-empty stdout line, which must parse as a JSON object, else -1;
# its stderr tail goes to output.
# A red-suite file whose sha256 differs from the dispatcher's is a change owned by the task whose
# writablePaths reach it, else by 'plan'. WORK_CHECK_TIMEOUT (seconds, default 1800) bounds each command.
# Every command sees WORK_READ_ONLY=1 under args.readOnly, else 0: a gate whose scope differs between a
# diagnose run (nothing edited, so judge the whole file) and a repair run (judge what it added) reads it.
# NON-VACUITY: a red, acceptance or mechanical command's FULL output (before the tail) goes through
# leg_counts.audit. A leg that printed no `<leg>: N <unit> examined` line, or a bare zero, turns an exit
# 0 or 1 into 2 (COULD-NOT-CHECK) and is named in the output's last lines and the summary.
set -euo pipefail

[[ $# -eq 3 ]] || { echo "usage: work-checks.sh ARGS RAW OUT" >&2; exit 2; }

python3 - "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" "$1" "$2" "$3" <<'PY'
import hashlib, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, sys.argv[1])
from leg_counts import audit

args_path, raw_path, out_path = sys.argv[2:5]
args = json.load(open(args_path))
raw = json.load(open(raw_path))
if not isinstance(raw, dict) or raw.get('stage') != 'agents' or not isinstance(raw.get('checkPlan'), dict):
    sys.exit(f'work-checks: {raw_path} is not an agents-stage result with a checkPlan')
plan = raw['checkPlan']
cwd = args.get('projectDir') or os.getcwd()
timeout = int(os.environ.get('WORK_CHECK_TIMEOUT', '1800'))
env = {**os.environ, 'WORK_READ_ONLY': '1' if args.get('readOnly') is True else '0'}
TAIL = 60
VACUOUS = {}   # cmd -> the audit's failures, for the summary line

def tail(s):
    return '\n'.join(s.splitlines()[-TAIL:])

def run(cmd):
    try:
        p = subprocess.run(['bash', '-c', cmd], cwd=cwd, env=env, capture_output=True, text=True,
                           errors='replace', timeout=timeout)
    except subprocess.TimeoutExpired:
        return -1, f'could not run: timed out after {timeout}s: {cmd}'
    except OSError as e:
        return -1, f'could not run: {e}: {cmd}'
    full = (p.stdout or '') + (p.stderr or '')
    if p.returncode in (126, 127):
        return -1, f'could not run (exit {p.returncode}): {cmd}\n{tail(full)}'
    vacuous = audit(full)
    if vacuous:
        full += ''.join(f'\nCOULD-NOT-CHECK: {v}' for v in vacuous)
        VACUOUS[cmd] = vacuous
        return max(p.returncode, 2), tail(full)
    return p.returncode, tail(full)

def run_rules(cmd):
    try:
        p = subprocess.run(['bash', '-c', cmd], cwd=cwd, env=env, capture_output=True, text=True,
                           errors='replace', timeout=timeout)
    except subprocess.TimeoutExpired:
        return -1, '', f'could not run: timed out after {timeout}s: {cmd}'
    except OSError as e:
        return -1, '', f'could not run: {e}: {cmd}'
    err = tail(p.stderr or '')
    if p.returncode in (126, 127):
        return -1, tail(p.stdout or ''), f'could not run (exit {p.returncode}): {cmd}\n{err}'
    lines = [l for l in (p.stdout or '').splitlines() if l.strip()]
    line = lines[-1].strip() if lines else ''
    try:
        ok = isinstance(json.loads(line), dict)
    except ValueError:
        ok = False
    if not ok:
        return -1, tail(p.stdout or ''), f'no JSON object on stdout (exit {p.returncode}): {cmd}\n{err}'
    return p.returncode, line, err

jobs = [('red', r['id'], r['command']) for r in plan.get('red') or []] \
     + [('acceptance', r['id'], r['command']) for r in plan.get('acceptance') or []] \
     + [('mechanical', r['name'], r['cmd']) for r in plan.get('mechanical') or []] \
     + [('rules', r['name'], r['cmd']) for r in plan.get('rules') or []]
with ThreadPoolExecutor(max_workers=max(1, min(8, len(jobs)))) as ex:
    results = list(ex.map(lambda j: run_rules(j[2]) if j[0] == 'rules' else run(j[2]), jobs))

out = {'red': [], 'acceptance': [], 'mechanical': [], 'rules': []}
for (kind, key, cmd), res in zip(jobs, results):
    if kind == 'rules':
        code, stdout, text = res
        out[kind].append({'name': key, 'cmd': cmd, 'exitCode': code, 'stdout': stdout, 'output': text})
        continue
    code, text = res
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
bad = [f"{k}:{r.get('id') or r.get('name')}={r['exitCode']}" for k in ('red', 'acceptance', 'mechanical', 'rules') for r in out[k] if r['exitCode'] != 0]
vac = [f"{k}:{key} {v.split(' — ')[0]}" for k, key, cmd in jobs for v in VACUOUS.get(cmd, [])]
print(f"work-checks: {len(jobs)} command(s), {len(bad)} non-zero{(' (' + ', '.join(bad) + ')') if bad else ''}; "
      f"red suite {len(hashes)} file(s), {len(changed)} changed -> {out_path}"
      + (f"\nwork-checks: COULD-NOT-CHECK {'; '.join(vac)}" if vac else ''))
PY
