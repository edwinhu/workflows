import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, readFileSync, mkdirSync, chmodSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

// farm.sh drives a real bash subprocess and a stub that sleeps; the per-test default is too tight.
setDefaultTimeout(60_000)

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

/**
 * A stub provider that records its argv size and stdin, sleeps (a real claude is silent for seconds
 * before its first stream line), then streams a turn with usage and six tool calls.
 */
function rig(extraStub = '', tail = '') {
  const root = mkTmp('farm-argv-')
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const cwd = join(root, 'cwd'); mkdirSync(cwd, { recursive: true })
  const usage = '"usage":{"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":100}'
  const tool = '{"type":"tool_use","id":"t","name":"Bash","input":{}}'
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash
n=0; for a in "$@"; do n=$((n + \${#a})); done; printf '%s' "$n" > "${root}/argv-bytes"
cat > "${root}/stdin"
${extraStub}
sleep 1
printf '%s\\n' '{"type":"assistant","message":{"id":"m1","model":"claude-sonnet-5-5","content":[${tool},${tool},${tool}],${usage}}}'
printf '%s\\n' '{"type":"assistant","message":{"id":"m2","model":"claude-sonnet-5-5","content":[${tool},${tool},${tool}],${usage}}}'
${tail}
printf '%s\\n' '{"type":"result","result":"done"}'
`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FARM_OUT_CHILD: '1',
                FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'), CLAUDE_CODE_SESSION_ID: '' }
  const done = () => readdirSync(join(root, 'farm-events'))
    .flatMap(f => readFileSync(join(root, 'farm-events', f), 'utf8').split('\n')).filter(l => l.includes(' DONE '))
  return { root, cwd, env, done, read: (f: string) => readFileSync(join(root, f), 'utf8') }
}

// Observed 2026-10-02 (secreg): a 168 KB args payload inlined into `-p` died
// "claude-code: Argument list too long", exit 126 — Linux caps ONE argv string at 128 KiB.
test('a --workflow dispatch with a 300 KB args payload never puts it on argv', () => {
  const root = mkTmp('farm-argv-wf-')
  const out = join(root, 'result.json')
  const wf = join(root, 'wf.js'); writeFileSync(wf, 'export const meta = { name: "x", description: "x" }\n')
  const args = join(root, 'args.json')
  writeFileSync(args, JSON.stringify({ projectDir: '/x', marker: 'ARGS-SENTINEL', pad: 'y'.repeat(300_000) }))
  // the stub delivers the artifact so the run is judged on transport alone
  const stubbed = rig(`printf '{}\\n' > "${out}"`)
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--no-cron', '--workflow', wf, '--args', args,
    '--out', out, '--cwd', stubbed.cwd], { encoding: 'utf8', env: stubbed.env, timeout: 120_000 })
  expect(res.stdout + res.stderr).not.toContain('Argument list too long')
  expect(res.status, res.stderr).toBe(0)
  expect(Number(stubbed.read('argv-bytes'))).toBeLessThan(4096)
  const stdin = stubbed.read('stdin')
  expect(stdin).toContain('ARGS-SENTINEL')
  expect(stdin).toContain('y'.repeat(300_000))
})

// Observed 2026-10-02: a row with 6 tool calls reported W=0, and so had every real DONE event on disk.
test('a row that streams usage reports non-zero W tokens', () => {
  const r = rig()
  const tasks = join(r.root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p' }]))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', r.cwd],
    { encoding: 'utf8', env: r.env, timeout: 120_000 })
  const row = JSON.parse(res.stdout)[0]
  expect(row.toolCalls).toBe(6)
  // per message: 1000 input + 5 * 100 output = 1500; two messages
  expect(row.tokensW).toBe(3000)
  expect(r.done().join('\n')).toMatch(/ok toolCalls=6 W=3000\b/)
})

test('a row whose turn budget is exceeded is stopped and reported, not run to the end', () => {
  const r = rig()
  const tasks = join(r.root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p' }]))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', r.cwd],
    { encoding: 'utf8', env: { ...r.env, FARM_MAX_TURNS: '1' }, timeout: 120_000 })
  const row = JSON.parse(res.stdout)[0]
  expect(row.budgetExceeded).toBe(true)
  expect(row.ok).toBe(false)
})

test('a runaway child past its turn cap is actually killed, not waited out', () => {
  const r = rig('', `printf '%s' $$ > "\${0%/bin/claude-code}/child-pid"\nexec sleep 45`)
  const tasks = join(r.root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p' }]))
  const t0 = Date.now()
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', r.cwd],
    { encoding: 'utf8', env: { ...r.env, FARM_MAX_TURNS: '1' }, timeout: 120_000 })
  expect(Date.now() - t0).toBeLessThan(30_000)
  expect(JSON.parse(res.stdout)[0].budgetExceeded).toBe(true)
  const pid = Number(r.read('child-pid'))
  let alive = true
  try { process.kill(pid, 0) } catch { alive = false }
  if (alive) process.kill(pid, 'SIGKILL')
  expect(alive).toBe(false)
})
