/**
 * scripts/test.sh is what canary.sh runs as "the full suite", so a python suite it does not run
 * gates no release. These pin the pytest leg: it runs over tests/ and every path in
 * tests/pytest-extra.txt with the deps in tests/pytest-deps.txt, and a failed, could-not-run or
 * summary-less pytest fails the script. `uv` is a stub on PATH; TEST_LEGS=pytest skips the bun leg.
 */
import { expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const ROOT = dirname(import.meta.dir)
setDefaultTimeout(150_000)
const mkTmp = useTmp()
const lines = (f: string) => readFileSync(join(ROOT, 'tests', f), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

/** Run `TEST_LEGS=pytest scripts/test.sh` with a uv stub that prints `out` and exits `rc`. */
function run(rc: number, out: string, args: string[] = [], legs: string | null = 'pytest') {
  const dir = mkTmp('pyleg-')
  const stub = join(dir, 'uv')
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${dir}/argv"\nprintf '%s\\n' ${JSON.stringify(out)}\nexit ${rc}\n`)
  chmodSync(stub, 0o755)
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'test.sh'), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_TMP_BASE: dir, ...(legs ? { TEST_LEGS: legs } : {}) },
  })
  let argv = ''
  try { argv = readFileSync(join(dir, 'argv'), 'utf8') } catch { /* uv never ran */ }
  return { status: r.status, text: `${r.stdout}${r.stderr}`, argv }
}

test('the pytest leg runs over tests/, every pytest-extra.txt path, and every pytest-deps.txt dep', () => {
  const r = run(0, '12 passed in 1.00s')
  expect(r.status, r.text).toBe(0)
  const a = r.argv.trim().split(' ')
  expect(a.slice(0, 3)).toEqual(['run', '--quiet', '--with'])
  expect(a).toContain('pytest-xdist')
  for (const dep of lines('pytest-deps.txt')) expect(a, dep).toContain(dep)
  const after = a.slice(a.indexOf('pytest') + 1)
  expect(after).toContain('tests/')
  for (const p of lines('pytest-extra.txt')) expect(after, p).toContain(p)
  expect(after).toContain('no:cacheprovider')
  expect(r.text).toContain('12 passed')
})

test('a non-zero pytest rc fails test.sh and the failed summary is printed', () => {
  const r = run(1, '3 failed, 9 passed in 2.00s')
  expect(r.status).not.toBe(0)
  expect(r.text).toContain('3 failed, 9 passed')
})

test('rc 0 with no `N passed` summary is could-not-run, not a pass', () => {
  const r = run(0, 'no tests ran in 0.01s')
  expect(r.status).not.toBe(0)
  expect(r.text).toMatch(/pytest/i)
})

test('a bun subset (paths given, TEST_LEGS unset) does not start the python suite', () => {
  const r = run(1, '1 failed', ['./tests/farm-ts-retired.test.ts'], null)
  expect(r.argv).toBe('')
  expect(r.text).not.toMatch(/pytest leg/i)
})
