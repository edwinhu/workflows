// The deterministic half of every ds Jev rule: it loads, states a proposition with the four criteria, and the
// calibration manifest holds a violating and a compliant case per rule id whose fixtures exist on disk. No model
// is called; the judged path is covered by skills/work/scripts/jev-evidence.test.ts against a stub judge.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

setDefaultTimeout(120_000)

const ROOT = join(import.meta.dir, '..')
const EVIDENCE = join(ROOT, 'checks/_jev/evidence.py')
const FIX = join(ROOT, 'tests/fixtures/jev')
const RULES_DIR = join(ROOT, 'checks/ds/rules')
const manifest = JSON.parse(readFileSync(join(FIX, 'calibration.json'), 'utf8'))
const dsRules: Record<string, { kind: string; path: string }[]> = manifest.sets.ds.rules

const ruleIds = (dir: string) => readdirSync(dir).filter(f => /^[^_.].*\.py$/.test(f)).map(f => f.replace(/\.py$/, '')).sort()
const WIRED = ruleIds(RULES_DIR)
const UNCALIBRATED = ruleIds(join(RULES_DIR, 'uncalibrated'))

function evidence(rulesDir: string, files: string[]) {
  const r = spawnSync('python3', [EVIDENCE, '--rules-dir', rulesDir, '--files', ...files], { encoding: 'utf8', timeout: 100_000 })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

test('the wired ds rules on disk are the nine the workflow names', () => {
  expect(WIRED).toEqual(['A1', 'A4', 'DEN', 'DQ4', 'DQ6', 'E7', 'M1', 'R1', 'UNI'])
  expect(UNCALIBRATED).toEqual(['DQ1'])
})

test('every ds rule loads and states a proposition, the four criteria and an examined key', () => {
  const sat = join(FIX, 'DQ1/sat/test.py')
  const out = { ...evidence(RULES_DIR, [sat]), ...evidence(join(RULES_DIR, 'uncalibrated'), [sat]) }
  for (const id of [...WIRED, ...UNCALIBRATED]) {
    expect(out[id], id).toBeDefined()
    expect(out[id].proposition.length, `${id} proposition`).toBeGreaterThan(40)
    expect(Object.keys(out[id].criteria).sort(), id).toEqual(['INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE', 'SATISFIED', 'VIOLATED'])
    expect(out[id].examinedKey, `${id} examinedKey`).toBeTruthy()
  }
})

test('every ds rule id has a violating and a compliant calibration case, and each case dir holds files', () => {
  expect(Object.keys(dsRules).sort()).toEqual([...WIRED, ...UNCALIBRATED].sort())
  for (const [id, cases] of Object.entries(dsRules)) {
    const kinds = new Set(cases.map(c => c.kind))
    expect([...kinds].sort(), id).toEqual(['compliant', 'violating'])
    for (const c of cases) {
      const dir = join(ROOT, c.path)
      expect(existsSync(dir), `${id}: ${c.path}`).toBe(true)
      expect(readdirSync(dir).length, `${id}: ${c.path} is empty`).toBeGreaterThan(0)
    }
  }
})

test('the manifest points the ds set at the rules directory on disk', () => {
  expect(manifest.sets.ds.rulesDir).toBe('checks/ds/rules')
})

test('DQ1 (uncalibrated) reports the diagnostic absent on its violating twin and present on its satisfying twin', () => {
  const state = (twin: string) => evidence(join(RULES_DIR, 'uncalibrated'), [join(FIX, `DQ1/${twin}/test.py`)]).DQ1.state
  const vio = state('vio'), sat = state('sat')
  expect(vio.n_lines_searched).toBeGreaterThan(0)
  expect(vio.searches[0].matches).toEqual([])
  expect(vio.searches[0].files_with_zero_matches.length).toBe(1)
  expect(sat.searches[0].matches.length).toBe(1)
  expect(sat.searches[0].files_with_zero_matches).toEqual([])
})
