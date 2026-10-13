/**
 * scripts/test.sh runs the suite with none of the caller's FARM_* / GRIND_* variables: a suite run
 * inside a farm child (FARM_OUT_CHILD=1, FARM_ROW_ID=...) made tests/farm-bgjob.test.ts fail 8 of 9,
 * because its fixture rows read the inherited row identity as their own. FARM_OUTCOMES, which test.sh
 * sets itself, stays.
 */
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const ROOT = dirname(import.meta.dir)

test('a FARM_* / GRIND_* variable set by the caller does not reach a test run through test.sh', () => {
  const dir = mkTmp('test-sh-env-')
  const probe = join(dir, 'probe.test.ts')
  writeFileSync(probe, `import { test } from 'bun:test'
test('probe', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(FARM|GRIND)_/.test(k)))
  console.log('PROBE_ENV=' + JSON.stringify(env))
})
`)
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'test.sh'), probe], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, FARM_OUT_CHILD: '1', FARM_ROW_ID: 'x', GRIND_RUN: 'y' },
  })
  const out = `${r.stdout}\n${r.stderr}`
  expect(r.status, out).toBe(0)
  const line = out.split('\n').find(l => l.includes('PROBE_ENV='))
  expect(line, out).toBeDefined()
  const env = JSON.parse(line!.slice(line!.indexOf('PROBE_ENV=') + 'PROBE_ENV='.length))
  expect(Object.keys(env).sort()).toEqual(['FARM_OUTCOMES'])
}, 150_000)
