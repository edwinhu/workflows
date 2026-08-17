#!/usr/bin/env bun
/**
 * converge-check.test.ts — the computed convergence diagnosis.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/converge-check.test.ts
 *   (absolute or ./-prefixed — a bare relative path is read as a NAME FILTER and exits 1 having
 *   matched nothing, which is byte-identical to a real failure.)
 *
 * Fixtures only: the script's inputs are files craft already writes, so a run dir is a directory
 * of JSON and nothing here needs a real run. The exit code is the verdict — 0 CONVERGING,
 * 1 NOT CONVERGING, 2 cannot judge.
 */
import { afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'converge-check.ts')
const scratch: string[] = []
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

type Round = { blocking: number; generated?: number; titles?: string[]; files?: string[] }

/** A run dir: one result-round<N>.json per entry, plus the args.json the rounds ran under. */
function mkRun(rounds: Round[], tasks: unknown[] = [{ id: 'T1', name: 'n', work: 'w', acceptance: 'a', writablePaths: ['src/'] }]) {
  const dir = mkdtempSync(join(tmpdir(), 'converge-'))
  scratch.push(dir)
  writeFileSync(join(dir, 'args.json'), JSON.stringify({ projectDir: dir, tasks }, null, 2))
  rounds.forEach((r, i) => {
    const titles = r.titles ?? Array.from({ length: r.blocking }, (_, k) => `finding ${i}-${k}`)
    const findings = titles.map((t, k) => ({
      title: t, severity: 'major', detail: 'd', lens: 'alpha',
      ...(r.files?.[k] ? { file: r.files[k] } : {}),
    }))
    writeFileSync(join(dir, `result-round${i + 1}.json`), JSON.stringify({
      overallPass: r.blocking === 0,
      verdict: r.blocking === 0 ? 'PASS' : 'FAIL',
      scoreTable: { survivingBlocking: r.blocking, lensFindings: r.generated ?? titles.length },
      findings,
    }, null, 2))
  })
  return dir
}

function run(dir: string, ...flags: string[]) {
  const r = spawnSync('bun', [SCRIPT, dir, ...flags], { encoding: 'utf8' })
  expect(typeof r.status, `converge-check.ts did not execute: ${r.error?.message ?? 'no exit status'}`).toBe('number')
  return { code: r.status as number, stdout: r.stdout || '', stderr: r.stderr || '' }
}

const json = (dir: string) => JSON.parse(run(dir, '--json').stdout)

// ---------------------------------------------------------------- too short to judge

test('a single-round dir reports too short to judge, not a verdict', () => {
  const r = run(mkRun([{ blocking: 3 }]))
  expect(r.code).toBe(2)
  expect(r.stdout).toContain('too short to judge')
  expect(r.stdout).not.toContain('NOT CONVERGING')
  expect(r.stdout).not.toMatch(/\bCONVERGING\b/)
})

test('a dir with no result files at all cannot judge and says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'converge-'))
  scratch.push(dir)
  writeFileSync(join(dir, 'args.json'), JSON.stringify({ projectDir: dir, tasks: [] }))
  const r = run(dir)
  expect(r.code).toBe(2)
  expect(r.stdout + r.stderr).toContain('too short to judge')
})

test('a nonexistent run dir is refused on stderr', () => {
  const r = run(join(tmpdir(), 'no-such-run-dir-converge'))
  expect(r.code).toBe(2)
  expect(r.stderr).toMatch(/no such|not a directory/i)
})

// ---------------------------------------------------------------- the blocking sequence IS the verdict

test('a blocking sequence that clears to zero is CONVERGING', () => {
  const r = run(mkRun([{ blocking: 4 }, { blocking: 1 }, { blocking: 1 }, { blocking: 0 }]))
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('CONVERGING')
  expect(r.stdout).not.toContain('NOT CONVERGING')
})

test('a non-increasing sequence with a net decrease is CONVERGING even without reaching zero', () => {
  expect(run(mkRun([{ blocking: 5 }, { blocking: 4 }, { blocking: 2 }])).code).toBe(0)
})

test('a sequence that rises at any round is NOT CONVERGING and names the round', () => {
  const r = run(mkRun([{ blocking: 7 }, { blocking: 9 }, { blocking: 8 }, { blocking: 6 }]))
  expect(r.code).toBe(1)
  expect(r.stdout).toContain('NOT CONVERGING')
  expect(r.stdout).toMatch(/rose at round 2/)
})

test('a flat non-zero sequence is NOT CONVERGING — no net decrease', () => {
  const r = run(mkRun([{ blocking: 3 }, { blocking: 3 }, { blocking: 3 }]))
  expect(r.code).toBe(1)
  expect(r.stdout).toContain('no net decrease')
})

// ---------------------------------------------------------------- accretion (self-contained, tier 1's rule)

test('accreted round markers make a run NOT CONVERGING and are named as the reason', () => {
  const dir = mkRun(
    [{ blocking: 4 }, { blocking: 2 }, { blocking: 1 }],
    [{ id: 'T1', name: 'n', acceptance: 'a', writablePaths: ['src/'],
       work: 'do it. ROUND 2 — also x. ROUND 3 — also y.' }],
  )
  const r = run(dir)
  expect(r.code).toBe(1)
  expect(r.stdout).toContain('NOT CONVERGING')
  expect(r.stdout).toContain('accretion')
  expect(r.stdout).toContain('T1')
})

// ---------------------------------------------------------------- the measured diagnostics

test('the repeat rate distinguishes a re-litigated finding from a fresh one', () => {
  const relit = json(mkRun([
    { blocking: 2, titles: ['alpha defect', 'beta defect'] },
    { blocking: 2, titles: ['alpha defect', 'gamma defect'] },
  ]))
  expect(relit.repeats.post).toBe(2)
  expect(relit.repeats.exact).toBe(1)

  const fresh = json(mkRun([
    { blocking: 2, titles: ['alpha defect', 'beta defect'] },
    { blocking: 2, titles: ['gamma defect', 'delta defect'] },
  ]))
  expect(fresh.repeats.exact).toBe(0)
})

test('a near-miss title counts as a Jaccard repeat but not an exact one', () => {
  const r = json(mkRun([
    { blocking: 1, titles: ['the red gate asserts existence only, not behaviour'] },
    { blocking: 1, titles: ['the red gate asserts existence only and not behaviour'] },
  ]))
  expect(r.repeats.exact).toBe(0)
  expect(r.repeats.jaccard).toBe(1)
})

test('generation slope is measured over the rounds, not asserted', () => {
  const flat = json(mkRun([{ blocking: 1, generated: 10 }, { blocking: 1, generated: 10 }, { blocking: 1, generated: 10 }]))
  expect(flat.generated.slope).toBe(0)
  const falling = json(mkRun([{ blocking: 3, generated: 12 }, { blocking: 2, generated: 8 }, { blocking: 1, generated: 4 }]))
  expect(falling.generated.slope).toBe(-4)
})

test('findings are split by whether their file is a task writable path', () => {
  const r = json(mkRun(
    [
      { blocking: 2, titles: ['a', 'b'], files: ['src/thing.ts:12', 'docs/README.md'] },
      { blocking: 1, titles: ['c'] },
    ],
    [{ id: 'T1', name: 'n', work: 'w', acceptance: 'a', writablePaths: ['src/'] }],
  ))
  expect(r.split).toEqual({ deliverable: 1, gate: 1, unattributed: 1 })
})

test('--json emits the whole diagnosis and the verdict, and prints nothing else', () => {
  const out = run(mkRun([{ blocking: 2 }, { blocking: 1 }]), '--json').stdout
  const r = JSON.parse(out)
  expect(r.verdict).toBe('CONVERGING')
  expect(r.rounds).toBe(2)
  expect(r.blocking).toEqual([2, 1])
  expect(Array.isArray(r.reasons)).toBe(true)
})
