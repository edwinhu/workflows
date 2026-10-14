/**
 * pytest.ini carries `-n auto`, so every pytest a test spawns forks one xdist worker per core. Under
 * `bun test --parallel` (one worker per core) that is cores x cores processes: load average 94-145
 * on 32 cores, and the timing-sensitive tests failed 2-17 at a time. scripts/test.sh exports
 * PYTEST_XDIST_AUTO_NUM_WORKERS so `auto` resolves to a small number inside the suite; a bare
 * pytest outside it keeps every core.
 */
import { expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const ROOT = dirname(import.meta.dir)
setDefaultTimeout(320_000) // each case runs uv + pytest, 300 s spawn cap
const mkTmp = useTmp()

/** Distinct xdist workers that ran a test when `-n auto` (from the repo's pytest.ini) meets `env`, or the inherited env if `inherit`. */
function workersUsed(env: Record<string, string | undefined>, inherit = false): number {
  const dir = mkTmp('pytest-workers-')
  writeFileSync(join(dir, 'test_many.py'), 'import pytest\n@pytest.mark.parametrize("i", range(64))\ndef test_x(i):\n    pass\n')
  const base: Record<string, string | undefined> = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  if (!inherit) delete base.PYTEST_XDIST_AUTO_NUM_WORKERS
  const e = { ...base, ...env }
  const r = spawnSync('uv', ['run', '--quiet', '--no-project', '--with', 'pytest', '--with', 'pytest-xdist', 'python3', '-m', 'pytest',
    '-c', join(ROOT, 'pytest.ini'), '--rootdir', dir, '-p', 'no:cacheprovider', `--basetemp=${join(dir, 'pt')}`, '-v', '--dist', 'each', dir],
  { cwd: dir, encoding: 'utf8', timeout: 300_000, env: e as NodeJS.ProcessEnv })
  const out = `${r.stdout}${r.stderr}`
  expect(r.status, out.slice(-3000)).toBe(0)
  return new Set([...out.matchAll(/\[(gw\d+)\]/g)].map(m => m[1])).size
}

test('the env var bounds what `-n auto` resolves to', () => {
  expect(workersUsed({ PYTEST_XDIST_AUTO_NUM_WORKERS: '2' })).toBe(2)
})

test('scripts/test.sh exports the bound, so every nested pytest inherits it', () => {
  expect(readFileSync(join(ROOT, 'scripts', 'test.sh'), 'utf8')).toMatch(/^export PYTEST_XDIST_AUTO_NUM_WORKERS="\$\{TEST_PYTEST_WORKERS:-[1-4]\}"/m)
})

test('inside the suite the inherited env alone keeps `-n auto` small', () => {
  if (process.env.WORKFLOWS_SUITE !== '1') return
  expect(workersUsed({}, true)).toBeLessThanOrEqual(4)
})
