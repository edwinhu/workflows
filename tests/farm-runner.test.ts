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
  const res = spawnSync('bash', [FARM, '--tasks', tasks, '--cwd', agentCwd], {
    encoding: 'utf8',
    cwd: root,                                   // deliberately NOT agentCwd
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1' },
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
  const res = spawnSync('bash', [FARM, '--tasks', tasks, '--cwd', agentCwd], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1' },
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
