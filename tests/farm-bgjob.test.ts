import { test, expect, setDefaultTimeout } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

setDefaultTimeout(70_000)

// A farm child must not be able to end while a process it started is still running (release-6381b,
// 2026-10-03: the child backgrounded `scripts/canary.sh --run`, ended its turn on "Still waiting on
// the canary.", and the canary died with it). Two halves: farm.sh names the orphaned job in the row
// outcome, and a Stop hook refuses the child's turn end while the job is alive.

const ROOT = join(import.meta.dir, '..')
const FARM = join(ROOT, 'skills', 'farm-out', 'scripts', 'farm.sh')
const BGJOBS = join(ROOT, 'skills', 'farm-out', 'scripts', 'bgjobs.py')

function alive(pid: number): boolean {
  try { process.kill(pid, 0) } catch { return false }
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.[0] !== 'Z' } catch { return false }
}

function runFarm(stubBody: string, rows: object[] = [{ label: 'bg', workflow: 'none', prompt: 'p' }]) {
  const root = mkdtempSync(join(tmpdir(), 'farmbg-'))
  const agentCwd = join(root, 'agentcwd')
  const bin = join(root, 'bin')
  mkdirSync(agentCwd, { recursive: true }); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\n${stubBody}\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(root, 'tasks.json')
  const outcomes = join(root, 'farm-outcomes.jsonl')
  writeFileSync(tasks, JSON.stringify(rows))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', agentCwd], {
    timeout: 120_000, encoding: 'utf8', cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1', FARM_OUTCOMES: outcomes,
           TMPDIR: root, CLAUDE_CODE_SESSION_ID: 'farm-bgjob-test', FARM_BG_GRACE: '0.5' },
  })
  const all = JSON.parse(res.stdout || '[]') as Record<string, any>[]
  const row = (all[0] ?? {}) as Record<string, any>
  const outcomeLines = existsSync(outcomes) ? readFileSync(outcomes, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  return { row, all, res, root, outcomeLines, pidFile: join(root, 'bg.pid') }
}

test('a child that backgrounds `sleep 60` and ends fails its row, naming the job, and the job does not outlive the row', () => {
  // setsid: the job escapes the child's process group, as a real `setsid nohup ... &` does.
  const { row, res, root, outcomeLines, pidFile } = runFarm(
    `setsid sleep 60 </dev/null >/dev/null 2>&1 & echo $! > "$TMPDIR/bg.pid"\nprintf '{"type":"result","result":"Still waiting on the job."}\\n'`)
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  try {
    expect(row.ok).toBe(false)
    expect(row.failure).toContain('ended with background job running: sleep 60')
    expect(row.orphaned.map((o: any) => o.cmd)).toEqual(['sleep 60'])
    expect(res.stderr).toContain('ended with background job running: sleep 60')
    const verdict = outcomeLines.find(l => l.type === 'verdict')
    expect(verdict?.checks).toContain('background-orphaned')
    expect(verdict?.why).toContain('ended with background job running: sleep 60')
    // The row record itself names the failure: ok=false with no reason left a reader guessing.
    const rec = outcomeLines.find(l => l.type === 'row')
    expect(rec?.failure).toContain('ended with background job running: sleep 60')
    expect(alive(pid)).toBe(false)
  } finally {
    try { process.kill(pid, 'SIGKILL') } catch {}
    rmSync(root, { recursive: true, force: true })
  }
}, 120_000)

test('rows of one --tasks run are reaped apart: a sibling still running a background job does not fail a row that ended clean', () => {
  // Row A backgrounds a job and is still running when row B ends; B must not be charged with A's job.
  const stub = `prompt=$(cat)
if [ "$prompt" != "\${prompt#A}" ]; then
  setsid sleep 61 </dev/null >/dev/null 2>&1 & echo $! > "$TMPDIR/bg.pid"
  sleep 4
  printf '{"type":"result","result":"A waiting."}\\n'
else
  sleep 1
  printf '{"type":"result","result":"B done."}\\n'
fi`
  const { all, root, outcomeLines, pidFile } = runFarm(stub, [
    { label: 'A', workflow: 'none', prompt: 'A' }, { label: 'B', workflow: 'none', prompt: 'B' }])
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  try {
    const a = all.find(r => r.label === 'A')!, b = all.find(r => r.label === 'B')!
    expect(b.orphaned).toEqual([])
    expect(b.ok).toBe(true)
    expect(a.ok).toBe(false)
    expect(a.orphaned.map((o: any) => o.cmd)).toEqual(['sleep 61'])
    expect(outcomeLines.filter(l => l.type === 'verdict').map(l => l.why).join('\n')).not.toContain('[B')
    expect(alive(pid)).toBe(false)
  } finally {
    try { process.kill(pid, 'SIGKILL') } catch {}
    rmSync(root, { recursive: true, force: true })
  }
}, 120_000)

test("an MCP server's detached telemetry watchdog outliving the session is not the child's orphan", () => {
  // 2026-10-13 teaching-ff-canary-green: chrome-devtools-mcp spawns its telemetry watchdog with
  // detached:true, and on parent death it posts a shutdown event over the network before exiting --
  // routinely longer than the reap grace. It carries FARM_ROW_ID, so the row failed orphaned=1.
  const stub = `wd="$TMPDIR/node_modules/chrome-devtools-mcp/build/src/telemetry/watchdog"
mkdir -p "$wd" && printf '#!/usr/bin/env bash\\nsleep 3\\n' > "$wd/main.js"
setsid bash "$wd/main.js" --parent-pid=$$ </dev/null >/dev/null 2>&1 &
printf '{"type":"result","result":"done"}\\n'`
  const { row, root } = runFarm(stub)
  try {
    expect(row.orphaned).toEqual([])
    expect(row.ok).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 120_000)

test("an MCP server's detached update check outliving the session is not the child's orphan", () => {
  // chrome-devtools-mcp 1.7.0 utils/check-for-updates.js spawns bin/check-latest-version.js with
  // detached:true at most once a day; it runs `npm config get registry` (5 s timeout) and one registry
  // fetch, then exits -- bounded, but routinely longer than the reap grace.
  const stub = `bin="$TMPDIR/node_modules/chrome-devtools-mcp/build/src/bin"
mkdir -p "$bin" && printf '#!/usr/bin/env bash\\nsleep 3\\n' > "$bin/check-latest-version.js"
setsid bash "$bin/check-latest-version.js" "$TMPDIR/latest.json" </dev/null >/dev/null 2>&1 &
printf '{"type":"result","result":"done"}\\n'`
  const { row, root } = runFarm(stub)
  try {
    expect(row.orphaned).toEqual([])
    expect(row.ok).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 120_000)

// What a real `claude -p` child writes when its turn ends with a run_in_background Bash live
// (captured 2026-10-03): the harness kills the task AFTER the result event, so no process survives
// for a scan to find. The stream is the evidence.
const BASH_USE = { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: {}, content: [
  { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'scripts/canary.sh --run', run_in_background: true } }] } }
const STARTED = { type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'toolu_1', description: 'Run the canary', is_backgrounded: true, task_type: 'local_bash' }
const RESULT = { type: 'result', subtype: 'success', result: 'Still waiting on the canary.' }
const KILLED = { type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { status: 'killed', end_time: 1 } }
const COMPLETED = { type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { status: 'completed', end_time: 1 } }
const emitLines = (evs: object[]) => evs.map(e => `printf '%s\\n' '${JSON.stringify(e)}'`).join('\n')

test('a background task the harness killed at turn end fails the row and names its command', () => {
  const { row, res, root } = runFarm(emitLines([BASH_USE, STARTED, RESULT, KILLED]))
  try {
    expect(row.ok).toBe(false)
    expect(row.orphaned).toEqual([{ cmd: 'scripts/canary.sh --run', source: 'stream', status: 'killed' }])
    expect(row.failure).toBe('ended with background job running: scripts/canary.sh --run')
    expect(res.stderr).toContain('bg ended with background job running: scripts/canary.sh --run')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 120_000)

test('a background task that finished inside the turn is not an orphan', () => {
  const { row, root } = runFarm(emitLines([BASH_USE, STARTED, COMPLETED, RESULT]))
  try {
    expect(row.orphaned).toEqual([])
    expect(row.ok).toBe(true)
    expect(row.failure).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 120_000)

// ------------------------------------------------------------------------ the Stop hook
//
// A fake child: a script named `claude` carrying FARM_ROW_ID, with the three kinds of process a real
// child has at its turn end -- an MCP server (a plain child: not a job), a run_in_background Bash
// (a shell launched through the harness's shell snapshot), and a setsid escapee (reparented away).

function runHookTree(opts: { rowEnv?: boolean, farmChild?: boolean, blocks?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'farmbghook-'))
  const fake = join(root, 'claude')
  const payload = join(root, 'payload.json')
  writeFileSync(payload, JSON.stringify({ session_id: 'sess-bg', transcript_path: '/nonexistent', stop_hook_active: false }))
  const snap = join(root, 'shell-snapshots', 'snapshot-bash-1-x.sh')
  mkdirSync(join(root, 'shell-snapshots'))
  writeFileSync(snap, '')
  const blocks = opts.blocks ?? 1
  writeFileSync(fake, `#!/usr/bin/env bash
sleep 59 </dev/null >/dev/null 2>&1 & echo $! > "${root}/mcp.pid"
/usr/bin/bash -c "source ${snap} 2>/dev/null || true && eval 'sleep 58 && echo '\\"'\\"'done'\\"'\\"'' < /dev/null" >/dev/null 2>&1 & echo $! > "${root}/job.pid"
( setsid sleep 57 </dev/null >/dev/null 2>&1 & echo $! > "${root}/esc.pid" )
# Wait until each job has exec'd its command (a fixed sleep lost the race under load), at most 10 s.
up() { local p; p=$(cat "${root}/$1.pid" 2>/dev/null) && [ -n "$p" ] && case "$(tr '\\0' ' ' < /proc/$p/cmdline 2>/dev/null)" in $2) return 0;; esac; return 1; }
for _ in $(seq 1 100); do up mcp 'sleep 59 ' && up job '*sleep 58*' && up esc 'sleep 57 ' && break; sleep 0.1; done
for i in $(seq 1 ${blocks}); do
  sh -c 'python3 "${BGJOBS}" hook' < "${payload}" > "${root}/out.$i.json" 2> "${root}/err.$i.txt"
done
`)
  chmodSync(fake, 0o755)
  const env: Record<string, string> = { ...process.env as Record<string, string>, TMPDIR: root }
  delete env.FARM_ROW_ID; delete env.FARM_OUT_CHILD
  if (opts.rowEnv !== false) env.FARM_ROW_ID = `hooktest-${process.pid}-${Date.now()}`
  if (opts.farmChild !== false) env.FARM_OUT_CHILD = '1'
  spawnSync(fake, [], { env, timeout: 60_000, encoding: 'utf8' })
  const pids = ['mcp', 'job', 'esc'].map(n => Number(readFileSync(join(root, `${n}.pid`), 'utf8').trim()))
  const outs = Array.from({ length: blocks }, (_, i) => readFileSync(join(root, `out.${i + 1}.json`), 'utf8'))
  const errs = Array.from({ length: blocks }, (_, i) => readFileSync(join(root, `err.${i + 1}.txt`), 'utf8'))
  const cleanup = () => {
    // the job shell's own sleep child too: kill by the row's marker
    spawnSync('bash', ['-c', `pkill -f '^sleep 5[789]$' ; true`], { timeout: 10_000 })
    for (const p of pids) { try { process.kill(p, 'SIGKILL') } catch {} }
    rmSync(root, { recursive: true, force: true })
  }
  return { outs, errs, cleanup }
}

test('the Stop hook blocks a farm child whose background jobs are alive, naming each, but not its MCP servers', () => {
  const { outs, cleanup } = runHookTree()
  try {
    const d = JSON.parse(outs[0])
    expect(d.decision).toBe('block')
    expect(d.reason).toContain("sleep 58 && echo 'done'")
    expect(d.reason).toContain('sleep 57')
    expect(d.reason).not.toContain('sleep 59')
  } finally { cleanup() }
}, 70_000)

test('the Stop hook is bounded: past its cap it allows the stop with a loud note', () => {
  const { outs, errs, cleanup } = runHookTree({ blocks: 9 })
  try {
    for (let i = 0; i < 8; i++) expect(JSON.parse(outs[i]).decision).toBe('block')
    expect(outs[8].trim() === '' || JSON.parse(outs[8]).decision !== 'block').toBe(true)
    expect(outs[8] + errs[8]).toContain('ALLOWING the stop with background job(s) still running')
  } finally { cleanup() }
}, 70_000)

test('the Stop hook never fires outside a farm child, nor for a child farm.sh did not mark', () => {
  for (const o of [{ farmChild: false }, { rowEnv: false }]) {
    const { outs, cleanup } = runHookTree(o)
    try { expect(outs[0].trim()).toBe('') } finally { cleanup() }
  }
}, 150_000)

test('hooks.json registers the background-job Stop hook', () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  const cmds = hooks.hooks.Stop.flatMap((m: any) => m.hooks.map((h: any) => h.command))
  expect(cmds).toContain('python3 ${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts/bgjobs.py hook')
})
