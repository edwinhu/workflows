import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(450_000)

// Every elide constraint, driven the way bin/workflow-check drives it (--project-dir/--files),
// on one committed fixture: a good input passes, and each mutation of it fails naming the defect.
// check.test.ts covers the same checkers through check.sh's positional legs; this pins the
// contract form, which is the only form `workflow-check elide` runs.

const ROOT = join(import.meta.dir, '..')
const CONSTRAINTS = join(ROOT, 'checks/elide/constraints')
const FIX = join(ROOT, 'skills/elide-case/fixtures')
const mkTmp = useTmp()

/** A project holding the mini addendum (with `edit` applied), the two sources and a plan. */
function project(edit: (typ: string) => string = t => t, plan = GOOD_PLAN) {
  const p = mkTmp('elide-cons-')
  mkdirSync(join(p, 'addenda'))
  mkdirSync(join(p, 'docs'))
  for (const f of ['SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt', 'SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt']) copyFileSync(join(FIX, 'docs', f), join(p, 'docs', f))
  writeFileSync(join(p, 'addenda/a.typ'), edit(readFileSync(join(FIX, 'mini-addendum.typ'), 'utf8')))
  writeFileSync(join(p, 'plan.md'), plan)
  return p
}

function contract(check: string, p: string, files: string[]) {
  const r = spawnSync('python3', [join(CONSTRAINTS, `${check}.py`), '--project-dir', p, '--plan', join(p, 'plan.md'), '--files', ...files.map(f => join(p, f))], { encoding: 'utf8', timeout: 200_000 })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const GOOD_PLAN = `# Plan

## Doctrinal target

- Doctrinal thread: pre-purchase managerial efforts count under Howey
- Cuts against: SEC v. Life Partners
- Taught for: reasoning

## Readings In Scope

| caption | source | page target |
|---|---|---|
| SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP. | docs/SEC-v-Mutual.txt | 2-6 |
`

describe('check-plan (contract form)', () => {
  test('a plan recording both answers and a page target passes', () => {
    const r = contract('check-plan', project(), ['plan.md'])
    expect(r.out).toContain('check-plan: 1 ')
    expect(r.code).toBe(0)
  })
  test('a plan with no Taught-for answer fails and names it', () => {
    const r = contract('check-plan', project(t => t, GOOD_PLAN.replace('- Taught for: reasoning\n', '')), ['plan.md'])
    expect(r.out).toContain("interview answer 2 absent: 'Taught for:'")
    expect(r.code).toBe(1)
  })
  test('a reading row with a placeholder page target fails and names the reading', () => {
    const r = contract('check-plan', project(t => t, GOOD_PLAN.replace('| 2-6 |', '| TBD |')), ['plan.md'])
    expect(r.out).toContain('has no page target')
    expect(r.code).toBe(1)
  })
  test('a plan with no Readings In Scope section fails', () => {
    const r = contract('check-plan', project(t => t, GOOD_PLAN.split('## Readings In Scope')[0]), ['plan.md'])
    expect(r.out).toContain("no '## Readings In Scope' section")
    expect(r.code).toBe(1)
  })
})

describe('check-marks (contract form)', () => {
  test('one elision spelling and a paired, renumbered footnote pass', () => {
    const r = contract('check-marks', project(), ['addenda/a.typ'])
    expect(r.out).toContain('check-marks: 1 ')
    expect(r.code).toBe(0)
  })
  test('a second elision spelling fails at its line', () => {
    const r = contract('check-marks', project(t => t.replace('[. . .] We affirm', '[...] We affirm')), ['addenda/a.typ'])
    expect(r.out).toContain('elision marks in one addendum')
    expect(r.code).toBe(1)
  })
  test('a retained footnote left at its original number fails', () => {
    const r = contract('check-marks', project(t => t.replace('#super[1]', '#super[16]')), ['addenda/a.typ'])
    expect(r.out).toContain('not 1..1')
    expect(r.code).toBe(1)
  })
  test('a marker whose body was dropped fails as an orphan', () => {
    const r = contract('check-marks', project(t => t.replace(/\n1\. As Judge Wald[^\n]*/, '')), ['addenda/a.typ'])
    expect(r.out).toContain('an orphan marker')
    expect(r.code).toBe(1)
  })
})

describe('check-addendum (contract form)', () => {
  test('a table whose pages match the compiled PDF passes', () => {
    const r = contract('check-addendum', project(), ['addenda/a.typ'])
    expect(r.out).toContain('check-addendum: 1 ')
    expect(r.code).toBe(0)
  })
  test('a table stating the wrong pages fails naming the true range', () => {
    const r = contract('check-addendum', project(t => t.replace('pp. 2--5', 'pp. 7--9')), ['addenda/a.typ'])
    expect(r.out).toContain('states pp. 7--9')
    expect(r.code).toBe(1)
  })
  test('a table row with no reading for it fails the arity check', () => {
    const r = contract('check-addendum', project(t => t.replace(/(\[pp\. 2--5\],\n)/, '$1  [8],\n  [An extra row],\n  [pp. 6--7],\n')), ['addenda/a.typ'])
    expect(r.out).toContain('FAIL arity')
    expect(r.code).toBe(1)
  })
})

describe('check-quotes (contract form)', () => {
  test('an excerpt verbatim in its source passes', () => {
    const r = contract('check-quotes', project(), ['addenda/a.typ'])
    expect(r.out).toContain('1 of 1 reading(s) verified verbatim')
    expect(r.code).toBe(0)
  })
  test('a reworded court sentence fails', () => {
    const r = contract('check-quotes', project(t => t.replace('MBC recruited doctors to evaluate', 'MBC hired physicians to assess')), ['addenda/a.typ'])
    expect(r.out).toMatch(/MISS|not found/)
    expect(r.code).toBe(1)
  })
})

describe('check-stranded-headings (contract form)', () => {
  /** The pymupdf interpreter the checker itself resolves, then the committed fixture builder. */
  function pdf(kind: 'clean' | 'stranded-heading') {
    const p = mkTmp('elide-stranded-')
    const w = spawnSync('python3', [join(CONSTRAINTS, 'check-stranded-headings.py'), p, '--which-python'], { encoding: 'utf8', timeout: 120_000 })
    expect(w.status, 'no interpreter with pymupdf: the stranded-heading check cannot run, which is not the same as passing').toBe(0)
    const out = join(p, `${kind}.pdf`)
    const b = spawnSync(w.stdout.trim(), [join(FIX, 'make-pagebreak-fixture.py'), kind, out], { encoding: 'utf8', timeout: 120_000 })
    expect(b.status, b.stderr).toBe(0)
    return { p, out }
  }
  test('a clean PDF passes', () => {
    const { p, out } = pdf('clean')
    const r = contract('check-stranded-headings', p, [out.slice(p.length + 1)].map(f => f))
    expect(r.out).toContain('check-stranded-headings: 1 ')
    expect(r.code).toBe(0)
  })
  test('a heading at the page foot with its text overleaf fails at that page', () => {
    const { p, out } = pdf('stranded-heading')
    const r = contract('check-stranded-headings', p, [out.slice(p.length + 1)])
    expect(r.out).toContain('stranded heading at the foot of page 1')
    expect(r.code).toBe(1)
  })
})
