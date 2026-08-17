#!/usr/bin/env bun
/**
 * plan-preflight.test.ts — TIER 2: the baseline exit-code reader.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/plan-preflight.test.ts
 *
 * Every case runs real commands in a real temp dir — that is the point of tier 2, and a mocked
 * exit code would test nothing.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preflight } from './plan-preflight.ts'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'craft-preflight-'))
  mkdirSync(join(dir, 'scripts'))
  const sh = (name: string, code: number) => {
    const p = join(dir, 'scripts', name)
    writeFileSync(p, `#!/bin/bash\nexit ${code}\n`)
    chmodSync(p, 0o755)
  }
  sh('green.sh', 0)
  sh('red.sh', 1)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const plan = (over: any = {}) => ({
  tasks: [],
  mechanicalChecks: [],
  reviewLenses: [],
  successCriteria: [],
  verification: [],
  testFirst: {},
  source: 'json' as const,
  ...over,
})
const task = (id: string, redCommand: string | null) => ({
  id,
  name: id,
  work: 'w',
  writablePaths: ['src/'],
  acceptance: 'a',
  redCommand,
  dependsOn: [],
  refs: [],
})
const opts = (over: any = {}) => ({ cwd: dir, timeout: 20, skip: new Set<string>(), unsafe: false, ...over })
const ruleset = (r: { defects: { rule: string }[] }) => r.defects.map(d => d.rule)

test('a red gate that is already GREEN at baseline is a critical defect', () => {
  const r = preflight(plan({ tasks: [task('T', 'bash scripts/green.sh')] }), opts())
  expect(ruleset(r)).toContain('red-gate-already-green')
  expect(r.defects[0].severity).toBe('critical')
})

test('a properly red gate produces no defect', () => {
  const r = preflight(plan({ tasks: [task('T', 'bash scripts/red.sh')] }), opts())
  expect(ruleset(r)).toEqual([])
})

test('a gate naming a binary this tree does not provide exits 127 and is critical', () => {
  const r = preflight(plan({ tasks: [task('T', 'definitely-not-a-real-binary-xyz sub')] }), opts())
  expect(ruleset(r)).toContain('gate-command-not-found')
})

test('a task with no redCommand is not probed', () => {
  const r = preflight(plan({ tasks: [task('T', null)] }), opts())
  expect(r.probes).toEqual([])
})

test('live-service commands are skipped by default and run under --unsafe', () => {
  const p = plan({ mechanicalChecks: [{ name: 'live', cmd: 'systemctl --user is-active whatever' }], tasks: [task('T', 'bash scripts/red.sh')] })
  expect(preflight(p, opts()).probes.find(x => x.key === 'live')?.skipped).toBeTruthy()
  expect(preflight(p, opts({ unsafe: true })).probes.find(x => x.key === 'live')?.skipped).toBeUndefined()
})

test('an explicitly skipped key is not executed', () => {
  const p = plan({ tasks: [task('T', 'bash scripts/green.sh')] })
  const r = preflight(p, opts({ skip: new Set(['T']) }))
  expect(ruleset(r)).toEqual([])
  expect(r.probes[0].skipped).toBe('named in --skip')
})

test('a skipped mechanical check does not count as red in the baseline split', () => {
  const p = plan({
    tasks: [task('T', 'bash scripts/red.sh')],
    mechanicalChecks: [
      { name: 'guard', cmd: 'bash scripts/green.sh' },
      { name: 'live', cmd: 'systemctl --user is-active whatever' },
    ],
  })
  const r = preflight(p, opts())
  // Only `guard` ran, and it is green — with nothing red there is no split to report.
  expect(ruleset(r)).not.toContain('baseline-split')
})

test('a mixed baseline reports the green/red split so guards must be declared', () => {
  const p = plan({
    tasks: [task('T', 'bash scripts/red.sh')],
    mechanicalChecks: [
      { name: 'guard', cmd: 'bash scripts/green.sh' },
      { name: 'target', cmd: 'bash scripts/red.sh' },
    ],
  })
  const d = preflight(p, opts()).defects.find(x => x.rule === 'baseline-split')
  expect(d?.evidence).toContain('green at baseline: guard')
  expect(d?.evidence).toContain('red at baseline: target')
})

// ---------------------------------------------------------------- acceptance probes

const accept = (acceptance: string, redCommand: string | null = null) => ({
  ...task('T', redCommand),
  acceptance,
})

test('an acceptance command naming a binary this tree does not provide is critical', () => {
  const r = preflight(plan({ tasks: [accept('`definitely-not-a-real-binary-xyz sub` exits 0')] }), opts())
  expect(ruleset(r)).toContain('acceptance-command-not-found')
  expect(r.defects.find(d => d.rule === 'acceptance-command-not-found')?.severity).toBe('critical')
})

test('an acceptance green at baseline on a task with no red gate is major', () => {
  const r = preflight(plan({ tasks: [accept('`bash scripts/green.sh` exits 0')] }), opts())
  expect(ruleset(r)).toContain('acceptance-green-at-baseline')
  expect(r.defects.find(d => d.rule === 'acceptance-green-at-baseline')?.severity).toBe('major')
})

test('a redCommand exempts the task — the red gate already carries that proof', () => {
  const r = preflight(plan({ tasks: [accept('`bash scripts/green.sh` exits 0', 'bash scripts/red.sh')] }), opts())
  expect(ruleset(r)).not.toContain('acceptance-green-at-baseline')
})

test('one red acceptance command is enough — the clause already distinguishes done from not', () => {
  const p = plan({ tasks: [accept('`bash scripts/green.sh` exits 0; `bash scripts/red.sh` exits 0')] })
  const r = preflight(p, opts())
  expect(ruleset(r)).not.toContain('acceptance-green-at-baseline')
  expect(r.probes.filter(x => x.kind === 'acceptance').map(x => x.status)).toEqual([0, 1])
})

test('every probed acceptance command is reported with its command and exit code', () => {
  const r = preflight(plan({ tasks: [accept('`bash scripts/green.sh` exits 0')] }), opts())
  const pr = r.probes.find(x => x.kind === 'acceptance')
  expect(pr?.key).toBe('T')
  expect(pr?.cmd).toBe('bash scripts/green.sh')
  expect(pr?.status).toBe(0)
})

test('an acceptance clause stating no command is not probed', () => {
  const r = preflight(plan({ tasks: [accept('the guard is documented in SKILL.md')] }), opts())
  expect(r.probes.filter(x => x.kind === 'acceptance')).toEqual([])
  expect(ruleset(r)).toEqual([])
})

test('--skip and the live-service denylist cover acceptance commands too', () => {
  const p = plan({ tasks: [accept('`bash scripts/green.sh` exits 0')] })
  expect(preflight(p, opts({ skip: new Set(['T']) })).probes[0].skipped).toBe('named in --skip')

  const live = plan({ tasks: [accept('`systemctl --user is-active whatever` exits 0')] })
  const r = preflight(live, opts())
  expect(r.probes[0].skipped).toBeTruthy()
  // Nothing ran, so nothing may be called green at baseline.
  expect(ruleset(r)).toEqual([])
})

test('--only acceptance probes acceptance and nothing else', () => {
  const p = plan({
    tasks: [accept('`bash scripts/green.sh` exits 0', 'bash scripts/green.sh')],
    mechanicalChecks: [{ name: 'guard', cmd: 'bash scripts/green.sh' }],
  })
  const r = preflight(p, opts({ only: 'acceptance' }))
  expect(r.probes.map(x => x.kind)).toEqual(['acceptance'])
  expect(ruleset(r)).toEqual([])
})
