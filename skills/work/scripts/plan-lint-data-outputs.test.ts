#!/usr/bin/env bun
// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task rows here are INPUT to the linter under test.
/**
 * plan-lint-data-outputs.test.ts — `data-outputs-undeclared`, the one plan-lint rule that reads
 * artifacts. It lives apart from plan-lint.test.ts because that file's rules need no tree, and
 * these fixtures are files on disk.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/plan-lint-data-outputs.test.ts
 *
 * nevada stage1 round 2 (2026-10-07) ended NOT CONVERGING on ds-dq FAILs that only a
 * `## Data Outputs` declaration could cure — then passed on the same files once declared.
 */
import { test, expect, setDefaultTimeout, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lint, type Plan } from './plan-lint.ts'

setDefaultTimeout(60_000)

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plan-lint-dq-'))
  mkdirSync(join(root, 'data'))
  // numerator/denominator null on the 8 median/SE/diff/n rows: DQ2 at 80%, by design.
  writeFileSync(
    join(root, 'data/table.csv'),
    'statistic,group,value,numerator,denominator\n' +
      'share,nv,0.1,1,10\nshare,de,0.2,4,20\n' +
      ['median', 'se', 'diff', 'n'].flatMap(s => [`${s},nv,1.0,,`, `${s},de,2.0,,`]).join('\n') + '\n',
  )
  // one URL per filing: DQ5 near-unique, by design.
  writeFileSync(
    join(root, 'data/backfill.csv'),
    'accession,fdate,url\n' +
      Array.from({ length: 10 }, (_, i) => `0000-${i},2026-09-1${i},https://sec.gov/${i}`).join('\n') + '\n',
  )
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const plan = (rows: string, tasks: Plan['tasks'] = []): Plan => ({
  tasks,
  mechanicalChecks: [],
  lens: null,
  successCriteria: [],
  verification: [],
  testFirst: {},
  source: 'json',
  projectDir: root,
  planText:
    '# p\n\n## Data Outputs\n\n| Path | Grain | Key Columns | Required Window |\n|---|---|---|---|\n' +
    rows +
    '\n## Next\n',
})

const UNDECLARED =
  '| data/table.csv | one row per statistic x group | statistic, group | n/a |\n' +
  '| data/backfill.csv | one row per filing | accession | n/a |\n'
const DECLARED =
  '| data/table.csv | one row per statistic x group | pk: statistic, group; sparse: numerator, denominator | n/a |\n' +
  '| data/backfill.csv | one row per filing | pk: accession; freetext: url | n/a |\n'

const dq = (p: Plan) => lint(p).filter(f => f.rule.startsWith('data-outputs-'))

test('an artifact failing ds-dq only for a missing declaration blocks dispatch', () => {
  const f = dq(plan(UNDECLARED))
  expect(f.map(x => x.rule)).toEqual(Array(3).fill('data-outputs-undeclared'))
  expect(f.every(x => x.severity === 'major')).toBe(true)
  const ev = f.map(x => `${x.where} ${x.message} ${x.evidence}`).join('\n')
  expect(ev).toContain('data/table.csv')
  expect(ev).toContain('sparse: numerator, denominator')
  expect(ev).toContain('freetext: url')
})

test('the same artifacts with the declarations in the plan are clean', () => {
  expect(dq(plan(DECLARED))).toEqual([])
})

test('a declared output not yet on disk is not a finding', () => {
  expect(dq(plan('| data/later.parquet | one row per id | id | n/a |\n'))).toEqual([])
})

test('a task that names the check and column it fixes owns the gap: advisory, not blocking', () => {
  const t = {
    id: 'T7',
    name: 'table',
    work: 'Rebuild data/table.csv; fixes DQ2 on numerator and denominator by computing them for every row.',
    writablePaths: ['data/table.csv'],
    acceptance: '`bash check.sh` exits 0',
    redCommand: null,
    redDisposition: null,
    dependsOn: [],
    refs: [],
  }
  const f = dq(plan('| data/table.csv | one row per statistic x group | statistic, group | n/a |\n', [t]))
  expect(f.length).toBe(2)
  expect(f.every(x => x.severity === 'minor')).toBe(true)
})

test('a Data Outputs table ds-dq cannot parse is a blocking finding', () => {
  const f = dq(plan('| data/table.csv | one row per statistic x group | statistic, group |\n'))
  expect(f.map(x => x.rule)).toEqual(['data-outputs-unparseable'])
  expect(f[0].severity).toBe('major')
})

test('a plan with no Data Outputs section is untouched', () => {
  const p = { ...plan(''), planText: '# p\n\n## Tasks\n' }
  expect(dq(p)).toEqual([])
})
