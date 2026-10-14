// ds's one mechanicalChecks entry (skills/ds/scripts/check.sh) must run the ds-dq contract suite:
// a break in checks/ds/constraints/ds-dq.py's parse has to turn the gate red, not pass over it.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(300_000)
const mkTmp = useTmp()
const CHECK = join(import.meta.dir, '..', 'skills', 'ds', 'scripts', 'check.sh')

const run = (env: Record<string, string> = {}, extra: string[] = ['--no-test-cmd', '--no-lint-cmd']) => {
  const d = mkTmp('ds-suite-leg-')
  mkdirSync(join(d, 'p'))
  writeFileSync(join(d, 'p', 'plan.md'), '# plan\n')
  return spawnSync('bash', [CHECK, '--plan', join(d, 'p', 'plan.md'), '--project-dir', join(d, 'p'), ...extra],
    { encoding: 'utf8', timeout: 280_000, env: { ...process.env, TMPDIR: mkTmp('ds-suite-tmpdir-'), ...env } }) // pytest's tmp_path root is $TMPDIR/pytest-of-<user>: swept with the fixture
}

test('a failing ds-dq contract suite fails the ds-dq-tests leg of check.sh', () => {
  const d = mkTmp('ds-suite-bad-')
  writeFileSync(join(d, 'bad_test.py'), 'def test_broken():\n    assert False\n')
  const r = run({ DS_DQ_SUITE: join(d, 'bad_test.py') })
  expect(r.stdout + r.stderr).toMatch(/leg ds-dq-tests exit=1/)
  expect(r.status).not.toBe(0)
})

test('the real ds-dq contract suite runs as a leg and passes', () => {
  const r = run()
  const out = r.stdout + r.stderr
  expect(out).toMatch(/leg ds-dq-tests exit=0/)
  expect(out).toMatch(/ds-dq-tests: [1-9]\d* test\(s\) examined/)
})

test('an undeclared --test-cmd or --lint-cmd refuses with exit 2 rather than passing a leg that ran nothing', () => {
  const none = run({}, [])
  expect(none.status).toBe(2)
  expect(none.stderr).toMatch(/--no-test-cmd/)
  const lintOnly = run({}, ['--no-test-cmd'])
  expect(lintOnly.status).toBe(2)
  expect(lintOnly.stderr).toMatch(/--lint-cmd or --no-lint-cmd/)
  expect(lintOnly.stderr).not.toMatch(/--test-cmd or --no-test-cmd/)
})

test('an explicit --no-test-cmd / --no-lint-cmd is a declared absence the legs report as such', () => {
  const r = run()
  expect(r.stderr).not.toMatch(/check\.sh: pass --/) // ds-gate itself may still exit 2 on the stub plan; the opt-out refusal must not fire
  expect(r.stdout + r.stderr).toMatch(/leg tests exit=0 \(declined by plan\)/)
  expect(r.stdout + r.stderr).toMatch(/leg lint exit=0 \(declined by plan\)/)
})
