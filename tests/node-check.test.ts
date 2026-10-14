// node-check.py syntax-checks a Workflow script (a .js opening with `export const meta`) the way the
// harness compiles it — as an AsyncFunction body, where a top-level `return` is legal — and keeps
// plain .js on `node --check`.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

setDefaultTimeout(90_000) // each case spawns python3 + node (60 s cap)
const SCRIPT = join(import.meta.dir, '..', 'checks', 'authoring', 'constraints', 'node-check.py')
const dir = mkdtempSync(join(tmpdir(), 'node-check-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function run(name: string, src: string) {
  const f = join(dir, name)
  writeFileSync(f, src)
  const r = spawnSync('python3', [SCRIPT, '--project-dir', dir, '--files', f], { encoding: 'utf8', timeout: 60_000 })
  return { code: r.status, out: r.stdout + r.stderr }
}

const META = "export const meta = { name: 'x', description: 'y' }\n"

test('a Workflow script with a top-level return and await passes', () => {
  const r = run('ok-wf.js', META + 'const v = await agent("a")\nreturn { v }\n')
  expect(r.out).not.toContain('Illegal return')
  expect(r.code).toBe(0)
})

test('a real syntax error in a Workflow script still fails', () => {
  const r = run('bad-wf.js', META + 'const = 1\nreturn 2\n')
  expect(r.code).toBe(1)
  expect(r.out).toContain('bad-wf.js:2:') // the line in the file, not in the compiled function
})

test('a plain .js syntax error still fails', () => {
  const r = run('plain-bad.js', 'const = 1\n')
  expect(r.code).toBe(1)
})

test('a plain .mjs module passes', () => {
  expect(run('ok.mjs', 'export const x = 1\n').code).toBe(0)
})

test('a plain .js that parses passes and is counted as examined', () => {
  const r = run('ok-plain.js', 'let a = 1\n')
  expect(r.code).toBe(0)
  expect(r.out).toContain('1 file(s) examined')
})

test('a non-.js file is out of scope even when its content would not parse', () => {
  const r = run('broken.txt', 'const = 1\n')
  expect(r.code).toBe(0)
  expect(r.out).toContain('nothing in scope')
})

test('no files handed in is an explicit empty scope, not a pass over something', () => {
  const r = spawnSync('python3', [SCRIPT, '--project-dir', dir, '--files'], { encoding: 'utf8', timeout: 60_000 })
  expect(r.status).toBe(0)
  expect(r.stdout + r.stderr).toContain('0 file(s) examined')
})

test('no node on PATH is COULD-NOT-RUN with exit 2, never a silent pass', () => {
  const f = join(dir, 'nonode.js')
  writeFileSync(f, 'const = 1\n')
  const empty = mkdtempSync(join(dir, 'nopath-'))
  const py = spawnSync('which', ['python3'], { encoding: 'utf8', timeout: 10_000 }).stdout.trim()
  const r = spawnSync(py, [SCRIPT, '--project-dir', dir, '--files', f], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PATH: empty } })
  expect(r.status).toBe(2)
  expect(r.stderr).toContain('COULD-NOT-RUN: node-check')
})
