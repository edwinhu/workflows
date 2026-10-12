// THE PYTHON PINS OF THE CHECKS, in the bun suite. The pytest files that pin a constraint's or rule's
// behaviour (checks/<workflow>/{constraints,rules}/, and scripts/prose-audit.py, which reads the writing
// constraints' tables) used to run only in plugin-audit's pytest leg, which no /work gate reaches: the
// dev gate runs this bun suite. So a constraint could change contract with every pin red and every
// gate green. This file runs them here, through pytest.
//
// The set is DERIVED, not listed: every tracked test_*.py / *_test.py whose text names a path through
// checks/<workflow>/(constraints|rules) or prose-audit.py. A pin added tomorrow runs the day it lands.
// Dependencies come from tests/pytest-deps.txt, the manifest plugin-audit's leg reads.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(600_000)
const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..')

const TOUCHES_LAYOUT = /checks["']?\s*[/,]\s*["']?[\w-]+["']?\s*[/,]\s*["']?(?:constraints|rules)\b|prose-audit\.py/
const pins = (spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }).stdout ?? '')
  .split('\n')
  .filter(f => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f))
  .filter(f => TOUCHES_LAYOUT.test(readFileSync(join(ROOT, f), 'utf8')))
  .sort()
const deps = readFileSync(join(ROOT, 'tests', 'pytest-deps.txt'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

test('the derivation finds the pins: the ds constraint suites, ds-dq, workshop-deck and the prose engine', () => {
  for (const f of ['tests/test_ds_chart_typography.py', 'tests/test_ds_waivers.py', 'skills/ds/scripts/ds_dq_test.py',
    'skills/workshop/scripts/workshop_deck_test.py', 'tests/test_prose_audit.py']) expect(pins).toContain(f)
})

test('every Python pin of the checks passes under pytest', () => {
  const base = mkTmp('python-pins-')
  const r = spawnSync('uv', ['run', '--quiet', '--no-project', '--with', 'pytest', '--with', 'pytest-xdist', ...deps.flatMap(d => ['--with', d]),
    'python3', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', `--basetemp=${join(base, 'pt')}`, ...pins],
  { cwd: ROOT, encoding: 'utf8', timeout: 580_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  expect(r.status, out.slice(-6000)).toBe(0)
  const passed = Number(/(\d+) passed/.exec(out)?.[1] ?? 0)
  expect(passed, 'pytest collected and passed nothing').toBeGreaterThan(200)
  expect(out).not.toMatch(/\d+ (failed|error)/)
})
