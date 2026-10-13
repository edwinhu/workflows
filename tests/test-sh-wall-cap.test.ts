/**
 * When scripts/test.sh's wall cap fires, the run names its cause: the slowest finished files, every
 * file still running with its elapsed time, and the process tree under the run (what the in-flight
 * file is waiting on). Three first runs on 2026-10-13 hit the 600 s cap with one file in flight and
 * bun's bare "Interrupted while still running" line; no run kept anything that said what that file was
 * doing, so none of the three could be diagnosed after the fact.
 */
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
const ROOT = dirname(import.meta.dir)

test('a run that hits the wall cap prints the slowest finished files, the in-flight files and their process tree', () => {
  const dir = mkTmp('test-sh-cap-')
  writeFileSync(join(dir, 'fast.test.ts'), `import { test } from 'bun:test'
test('fast', () => {})
`)
  writeFileSync(join(dir, 'slow.test.ts'), `import { test } from 'bun:test'
test('slow', async () => { await Bun.sleep(2000) })
`)
  // A child the test waits on, the way a stuck spawn holds a real file: its argv must reach the dump.
  writeFileSync(join(dir, 'hung.test.ts'), `import { test } from 'bun:test'
test('hung', async () => { await Bun.spawn(['sleep', '297']).exited }, 600_000)
`)
  const r = spawnSync('bash', [join(ROOT, 'scripts', 'test.sh'), dir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, TEST_WALL: '8' },
  })
  const out = `${r.stdout}\n${r.stderr}`
  expect(r.status, out).toBe(124)
  expect(out).toMatch(/WALL CAP \(8 s\) FIRED/)
  // bun's own "Interrupted while still running" precedes the report, so every slice starts at it
  const report = out.slice(out.indexOf('WALL CAP'))
  const finished = report.slice(report.indexOf('slowest finished'), report.indexOf('still running'))
  expect(finished, out).toMatch(/\d+\.\ds +\S*slow\.test\.ts[\s\S]*fast\.test\.ts/)
  const running = report.slice(report.indexOf('still running'), report.indexOf('process tree'))
  expect(running, out).toMatch(/\d+\.\ds +\S*hung\.test\.ts/)
  expect(running).not.toContain('slow.test.ts')
  expect(report.slice(report.indexOf('process tree')), out).toContain('sleep 297')
}, 120_000)
