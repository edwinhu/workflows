import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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

function runFarm(stubBody: string) {
  const root = mkdtempSync(join(tmpdir(), 'farmbg-'))
  const agentCwd = join(root, 'agentcwd')
  const bin = join(root, 'bin')
  mkdirSync(agentCwd, { recursive: true }); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\n${stubBody}\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(root, 'tasks.json')
  const outcomes = join(root, 'farm-outcomes.jsonl')
  writeFileSync(tasks, JSON.stringify([{ label: 'bg', prompt: 'p' }]))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', agentCwd], {
    timeout: 120_000, encoding: 'utf8', cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1', FARM_OUTCOMES: outcomes,
           TMPDIR: root, CLAUDE_CODE_SESSION_ID: 'farm-bgjob-test', FARM_BG_GRACE: '0.5' },
  })
  const row = (JSON.parse(res.stdout || '[]')[0] ?? {}) as Record<string, any>
  const outcomeLines = existsSync(outcomes) ? readFileSync(outcomes, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  return { row, res, root, outcomeLines, pidFile: join(root, 'bg.pid') }
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
    expect(alive(pid)).toBe(false)
  } finally {
    try { process.kill(pid, 'SIGKILL') } catch {}
    rmSync(root, { recursive: true, force: true })
  }
})

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
})

test('a background task that finished inside the turn is not an orphan', () => {
  const { row, root } = runFarm(emitLines([BASH_USE, STARTED, COMPLETED, RESULT]))
  try {
    expect(row.orphaned).toEqual([])
    expect(row.ok).toBe(true)
    expect(row.failure).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

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
sleep 0.3
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
}, 30_000)

test('the Stop hook is bounded: past its cap it allows the stop with a loud note', () => {
  const { outs, errs, cleanup } = runHookTree({ blocks: 9 })
  try {
    for (let i = 0; i < 8; i++) expect(JSON.parse(outs[i]).decision).toBe('block')
    expect(outs[8].trim() === '' || JSON.parse(outs[8]).decision !== 'block').toBe(true)
    expect(outs[8] + errs[8]).toContain('ALLOWING the stop with background job(s) still running')
  } finally { cleanup() }
}, 30_000)

test('the Stop hook never fires outside a farm child, nor for a child farm.sh did not mark', () => {
  for (const o of [{ farmChild: false }, { rowEnv: false }]) {
    const { outs, cleanup } = runHookTree(o)
    try { expect(outs[0].trim()).toBe('') } finally { cleanup() }
  }
}, 30_000)

test('hooks.json registers the background-job Stop hook', () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  const cmds = hooks.hooks.Stop.flatMap((m: any) => m.hooks.map((h: any) => h.command))
  expect(cmds).toContain('python3 ${CLAUDE_PLUGIN_ROOT}/skills/farm-out/scripts/bgjobs.py hook')
})
