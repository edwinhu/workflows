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

// The refusal fires before any leg runs, so it needs no pytest-sized timeout.
const refuse = (extra: string[]) => spawnSync('bash', [CHECK, '--plan', '/nonexistent/plan.md', '--project-dir', '.', ...extra],
  { encoding: 'utf8', timeout: 20_000 })

test('an undeclared --test-cmd or --lint-cmd refuses with exit 2 rather than passing a leg that ran nothing', () => {
  const none = refuse([])
  expect(none.status).toBe(2)
  expect(none.stderr).toMatch(/--no-test-cmd/)
  const lintOnly = refuse(['--no-test-cmd'])
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

// --- SKILL.md / rule-body contracts of the ds entry point ---
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = join(import.meta.dir, '..')
const SKILL = readFileSync(join(ROOT, 'skills', 'ds', 'SKILL.md'), 'utf8')

test('the single ds entry takes test/lint as arguments: no passage says they become mechanicalChecks entries', () => {
  expect(SKILL).not.toMatch(/become\s+`mechanicalChecks`\s+verbatim/)
  expect(SKILL).toMatch(/`--test-cmd` \/ `--lint-cmd` arguments of the single `ds` mechanical entry/)
})

test('SKILL.md carries no narrated history (dated rewrite, incident percentage)', () => {
  expect(SKILL).not.toMatch(/until 2026-09-15/)
  expect(SKILL).not.toMatch(/43\.7%/)
})

test('a test command containing quotes and $ reaches check.sh intact through the SKILL.md quoting helper', () => {
  const helper = /^const shq = .*$/m.exec(SKILL)?.[0]
  expect(helper, 'SKILL.md defines no shq helper').toBeDefined()
  expect(SKILL).toMatch(/--test-cmd \$\{shq\(testCmd\)\}/)
  expect(SKILL).toMatch(/--lint-cmd \$\{shq\(lintCmd\)\}/)
  const shq = new Function(`${helper}; return shq`)() as (s: string) => string
  for (const cmd of ['pytest -k "fit"', 'echo $HOME && it\'s', 'pytest -k "a or b" -x']) {
    const r = spawnSync('bash', ['-c', `printf '%s\\n' --test-cmd ${shq(cmd)}`], { encoding: 'utf8', timeout: 20_000 })
    expect(r.stdout).toBe(`--test-cmd\n${cmd}\n`)
  }
})

test('polars is pinned identically in check.sh and ds-dq.py, and the version is printed', () => {
  const dq = readFileSync(join(ROOT, 'checks', 'ds', 'constraints', 'ds-dq.py'), 'utf8')
  const pin = /^POLARS_PIN = "(\d+\.\d+\.\d+)"/m.exec(dq)?.[1]
  expect(pin, 'ds-dq.py defines no POLARS_PIN').toBeDefined()
  expect(dq).toContain('"--with", f"polars=={POLARS_PIN}"')
  expect(dq).toMatch(/polars \{polars\.__version__\}/)
  const sh = readFileSync(CHECK, 'utf8')
  expect(sh).toContain('polars==$POLARS_PIN')
  expect(sh).toMatch(/POLARS_PIN="\$\(sed .*ds-dq\.py/)
  const r = run()
  expect(r.stderr).toContain(`ds-dq-tests: polars==${pin}`)
})

test('every ds rule body is scoped to the one workflow that runs, [ds]', () => {
  const dir = join(ROOT, 'rules')
  const bodies = readdirSync(dir).filter(f => /^ds-.*\.md$/.test(f))
  expect(bodies.length).toBeGreaterThan(20)
  for (const f of bodies) {
    const line = /^applies-to:.*$/m.exec(readFileSync(join(dir, f), 'utf8'))?.[0]
    expect(`${f}: ${line}`).toBe(`${f}: applies-to: [ds]`)
  }
})
