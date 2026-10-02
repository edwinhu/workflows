import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FARM = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'farm.sh')

// A stub wrapper on PATH: farm.sh shells `claude-code`, and this test is about path
// resolution, not delegation. The stub writes the artifact the row expects, at a path
// RELATIVE to the cwd farm.sh hands it -- which is the whole question.
function runFarm(expectPath: string, opts: { writeRelative?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'farmtest-'))
  const agentCwd = join(root, 'agentcwd')
  const bin = join(root, 'bin')
  mkdirSync(agentCwd, { recursive: true }); mkdirSync(bin, { recursive: true })
  const stub = join(bin, 'claude-code')
  const w = opts.writeRelative
  writeFileSync(stub, `#!/usr/bin/env bash\n${w ? `printf 'x\\n' > "${join(agentCwd, w)}"` : ':'}\nprintf '{"type":"result","result":"done"}\\n'\n`)
  chmodSync(stub, 0o755)
  const tasks = join(root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'p', expect: expectPath }]))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', agentCwd], {
    encoding: 'utf8',
    cwd: root,                                   // deliberately NOT agentCwd
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1', FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'),
           // the sandbox's own event stream: a live session's watcher mod would wake on these rows
           TMPDIR: root, CLAUDE_CODE_SESSION_ID: 'farm-runner-test' },
  })
  const parsed = JSON.parse(res.stdout || '[]')
  rmSync(root, { recursive: true, force: true })
  return parsed[0] ?? {}
}

test('a relative --expect resolves against --cwd, not the caller cwd', () => {
  const row = runFarm('out.md', { writeRelative: 'out.md' })
  expect(row.missing).toEqual([])
  expect(row.ok).toBe(true)
})

test('a relative --expect the agent never wrote is still reported missing', () => {
  const row = runFarm('out.md')
  expect(row.missing).toEqual(['out.md'])
  expect(row.ok).toBe(false)
})

// A row's `model` is advertised in farm-out/SKILL.md as a task-row field. The stub records the
// argv farm.sh built instead of making a call, so the flag is checked without reaching a provider.
function runRow(row: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'farmtest-'))
  const agentCwd = join(root, 'agentcwd')
  const bin = join(root, 'bin')
  mkdirSync(agentCwd, { recursive: true }); mkdirSync(bin, { recursive: true })
  const argvFile = join(root, 'argv.txt')
  const stub = join(bin, 'claude-code')
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvFile}"\nprintf '{"type":"result","result":"done"}\\n'\n`)
  chmodSync(stub, 0o755)
  const tasks = join(root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify([row]))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', agentCwd], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1', FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'),
           // the sandbox's own event stream: a live session's watcher mod would wake on these rows
           TMPDIR: root, CLAUDE_CODE_SESSION_ID: 'farm-runner-test' },
  })
  let argv: string[] = []
  try { argv = readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) } catch { /* never invoked */ }
  rmSync(root, { recursive: true, force: true })
  return { argv, status: res.status, stderr: res.stderr }
}

test("a row's model reaches the wrapper as --model", () => {
  const { argv } = runRow({ label: 'r', prompt: 'p', model: 'gpt-5.6-luna' })
  expect(argv).toContain('--model')
  expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-5.6-luna')
})

test('a row with no model passes no --model flag — the wrapper default stands', () => {
  const { argv } = runRow({ label: 'r', prompt: 'p' })
  expect(argv.length).toBeGreaterThan(0)
  expect(argv).not.toContain('--model')
})

test('a null model is coerced to empty and passes no --model flag', () => {
  const { argv } = runRow({ label: 'r', prompt: 'p', model: null })
  expect(argv.length).toBeGreaterThan(0)
  expect(argv).not.toContain('--model')
})

test('a model carrying a control character is refused before the wrapper is invoked', () => {
  const { argv, status, stderr } = runRow({ label: 'r', prompt: 'p', model: 'good\tbad' })
  expect(argv).toEqual([])
  expect(status).toBe(2)
  expect(stderr).toMatch(/model contains a control character/)
})

function runFanout(rows: Record<string, unknown>[], spend: number | null = 0, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'farmtest-'))
  try {
    const agentCwd = join(root, 'agentcwd')
    const bin = join(root, 'bin')
    const events = join(root, 'farm-events', 'estimate-test')
    mkdirSync(agentCwd); mkdirSync(bin); mkdirSync(events, { recursive: true })
    writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\nprintf '{"type":"result","result":"done"}\\n'\n`)
    chmodSync(join(bin, 'claude-code'), 0o755)
    if (spend !== null) writeFileSync(join(events, 'spend.ndjson'), JSON.stringify({ tokensW: spend }) + '\n')
    const tasks = join(root, 'tasks.json')
    writeFileSync(tasks, JSON.stringify(rows))
    return spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', agentCwd], {
      encoding: 'utf8', cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root,
        CLAUDE_CODE_SESSION_ID: 'estimate-test', FARM_OUT_CHILD: '1', FARM_OUTCOMES: join(root, 'farm-outcomes.jsonl'),
        FARM_TASK_BUDGET: '4000000', FARM_SESSION_BUDGET: '20000000',
        FARM_TASK_ESTIMATE: '750000', FARM_BUDGET_OVERRIDE: '0', ...env },
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const sevenRows = Array.from({ length: 7 }, (_, i) => ({ label: `row-${i}`, prompt: 'p' }))

test('seven rows at zero spend use the median estimate, not full task budgets', () => {
  const res = runFanout(sevenRows)
  expect(res.status).toBe(0)
  expect(JSON.parse(res.stdout)).toHaveLength(7)
  expect(res.stderr).toContain('Estimate for 7 task(s): 5250000 tokensW')
  expect(res.stderr).toContain('Session spend so far: 0 tokensW')
  expect(res.stderr).not.toContain('Session spend so far: 00')
})

test('spend plus fan-out estimate exceeding the session cap is refused', () => {
  const res = runFanout(sevenRows, 15000000)
  expect(res.status).toBe(2)
  expect(res.stderr).toContain('Session budget exceeded up front: 20250000')
  expect(res.stdout).toBe('')
})

test('the estimate is capped at each row budget', () => {
  const res = runFanout([{ label: 'small', prompt: 'p', budget: 100000 }])
  expect(res.status).toBe(0)
  expect(res.stderr).toContain('Estimate for 1 task(s): 100000 tokensW')
})

test('the estimate is capped at the default task budget and accepts an override', () => {
  const res = runFanout([{ label: 'small', prompt: 'p' }], 0, { FARM_TASK_ESTIMATE: '5000000' })
  expect(res.status).toBe(0)
  expect(res.stderr).toContain('Estimate for 1 task(s): 4000000 tokensW')
})

test('empty session event files display a single zero', () => {
  const res = runFanout([{ label: 'zero', prompt: 'p' }], null)
  expect(res.stderr).toContain('Session spend so far: 0 tokensW')
  expect(res.stderr).not.toContain('Session spend so far: 00')
})
