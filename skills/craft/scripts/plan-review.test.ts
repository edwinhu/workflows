#!/usr/bin/env bun
/**
 * plan-review.test.ts — the corpus the write-side-migration-r3 plan lenses produced by hand, plus
 * the guards that keep the judged layer from coming back.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/plan-review.test.ts
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Plan } from './plan-lint.ts'
import * as preflightMod from './plan-preflight.ts'

const CRAFT = `${import.meta.dir}/..`
const SCRIPTS = join(CRAFT, 'scripts')

const base = (over: Partial<Plan> = {}): Plan => ({
  tasks: [],
  mechanicalChecks: [],
  reviewLenses: [],
  planLenses: [],
  successCriteria: [],
  verification: [],
  testFirst: {},
  source: 'json',
  ...over,
})

const task = (over: Partial<Plan['tasks'][0]> = {}) => ({
  id: 'T1',
  name: 'task',
  work: 'do the thing',
  writablePaths: ['src/'],
  acceptance: '`bash scripts/check.sh` exits 0',
  redCommand: 'bash scripts/check.sh',
  redDisposition: null,
  dependsOn: [],
  refs: [],
  ...over,
})

// ---------------------------------------------------------------- preflight: acceptance probes
//
// The probe kind and both defect names are the behaviour under construction. `preflight` is reached
// through the namespace so a changed export surface fails these three tests and not the file.

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'craft-plan-review-'))
  mkdirSync(join(dir, 'scripts'))
  for (const [name, code] of [['green.sh', 0], ['red.sh', 1]] as const) {
    const p = join(dir, 'scripts', name)
    writeFileSync(p, `#!/bin/bash\nexit ${code}\n`)
    chmodSync(p, 0o755)
  }
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const pfPlan = (over: any = {}) => ({ ...base(), ...over })
const pfOpts = (over: any = {}) => ({ cwd: dir, timeout: 20, skip: new Set<string>(), unsafe: false, only: 'acceptance', ...over })

/** Fails as an assertion, never as a module-load crash, if the export this needs is not there. */
const probe = (p: any, o: any) => {
  const fn = (preflightMod as any).preflight
  expect(typeof fn).toBe('function')
  return fn(p, o) as { defects: { rule: string }[] }
}
const defects = (r: { defects: { rule: string }[] }) => r.defects.map(d => d.rule)

test('preflight: an acceptance command that exits 127 at baseline is acceptance-command-not-found', () => {
  const p = pfPlan({
    tasks: [task({ id: 'T', redCommand: null, redDisposition: 'work complete', acceptance: '`definitely-not-a-real-binary-xyz sub` exits 0' })],
  })
  expect(defects(probe(p, pfOpts()))).toContain('acceptance-command-not-found')
})

test('preflight: an acceptance command green at baseline with no redCommand is acceptance-green-at-baseline', () => {
  const p = pfPlan({
    tasks: [task({ id: 'T', redCommand: null, redDisposition: 'work complete', acceptance: '`bash scripts/green.sh` exits 0' })],
  })
  expect(defects(probe(p, pfOpts()))).toContain('acceptance-green-at-baseline')
})

test('preflight: a task WITH a redCommand carries the proof already — a green acceptance is not a defect', () => {
  const p = pfPlan({
    tasks: [task({ id: 'T', redCommand: 'bash scripts/red.sh', acceptance: '`bash scripts/green.sh` exits 0' })],
  })
  expect(defects(probe(p, pfOpts()))).not.toContain('acceptance-green-at-baseline')
})

// ---------------------------------------------------------------- deletion: the judged layer is gone

test('deletion:workflow — workflow.js carries no plan-lens layer', () => {
  const src = readFileSync(join(CRAFT, 'workflow.js'), 'utf8')
  for (const token of ['planLenses', 'PLAN_LENS_SCHEMA', 'planThatFlagged', 'planSurviving'])
    expect(src).not.toContain(token)
  expect(src).not.toMatch(/title:\s*['"]Plan review['"]/)
})

test('deletion:scripts — no script carries the plan-round-cap machinery', () => {
  const TOKENS = ['planRounds', 'openPlanFindings', 'PLAN_ROUND_CAP', 'plan-round-cap-undisposed']
  const hits: string[] = []
  for (const e of readdirSync(SCRIPTS, { withFileTypes: true })) {
    if (!e.isFile() || e.name === 'plan-review.test.ts') continue
    const src = readFileSync(join(SCRIPTS, e.name), 'utf8')
    for (const t of TOKENS) if (src.includes(t)) hits.push(`${e.name}:${t}`)
  }
  expect(hits).toEqual([])
})

test('deletion:scripts — craft-result.sh no longer names the plan channel', () => {
  expect(readFileSync(join(SCRIPTS, 'craft-result.sh'), 'utf8')).not.toContain('planThatFlagged')
})

test('deletion:scripts — plan-lint.ts still carries out.planText, the prose-command substrate', () => {
  expect(readFileSync(join(SCRIPTS, 'plan-lint.ts'), 'utf8')).toContain('out.planText')
})

test('deletion:docs — SKILL.md and references/ no longer describe plan lenses', () => {
  expect(readFileSync(join(CRAFT, 'SKILL.md'), 'utf8').toLowerCase()).not.toContain('planlens')
  expect(existsSync(join(CRAFT, 'references', 'plan-review-convergence.md'))).toBe(false)
})
