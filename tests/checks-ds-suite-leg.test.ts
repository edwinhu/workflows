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

const run = (env: Record<string, string> = {}) => {
  const d = mkTmp('ds-suite-leg-')
  mkdirSync(join(d, 'p'))
  writeFileSync(join(d, 'p', 'plan.md'), '# plan\n')
  return spawnSync('bash', [CHECK, '--plan', join(d, 'p', 'plan.md'), '--project-dir', join(d, 'p')],
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
