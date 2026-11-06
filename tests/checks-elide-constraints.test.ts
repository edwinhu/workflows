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

describe('editorial summary (check-marks and check-quotes, contract form)', () => {
  const AT = 'form provided by MBC. [. . .]'
  const GOOD = '#emph[[Summary: The court then describes the escrow arrangements and the later course of the district court proceedings. It returns to the investment-contract question below.]]'
  const put = (summary: string, at = AT, keep = 'form provided by MBC. ') => (t: string) => t.replace(at, keep + summary)
  const marks = (edit: (t: string) => string) => contract('check-marks', project(edit), ['addenda/a.typ'])

  test('a correct summary standing in for the [. . .] passes check-marks and check-quotes, counted', () => {
    const p = project(put(GOOD))
    const m = contract('check-marks', p, ['addenda/a.typ'])
    expect(m.out).toContain('a.typ: 1 editorial summary span(s)')
    expect(m.code).toBe(0)
    const q = contract('check-quotes', p, ['addenda/a.typ'])
    expect(q.out).toContain('1 of 1 reading(s) verified verbatim')
    expect(q.out).toContain('1 editorial summary span(s) skipped as elisions')
    expect(q.code).toBe(0)
  })
  const positional = (edit: (t: string) => string) => spawnSync('python3', [join(CONSTRAINTS, 'check-marks.py'), join(project(edit), 'addenda/a.typ')], { encoding: 'utf8' }).stdout
  test('the fixture as committed has no summary and says so', () => {
    expect(positional(t => t)).toContain('summaries: PASS — no editorial summary')
  })
  test('F1: a summary in any other wrapping fails, naming the line and the form', () => {
    for (const bad of ['[Summary: The court describes the escrow arrangements.]', '_[Summary: The court describes the escrow arrangements._]',
      '#emph[Summary: The court describes the escrow arrangements.]', "[Editors' summary: The court describes the escrow arrangements.]",
      '[_Summary_: The court describes the escrow arrangements.]']) {
      const r = marks(put(bad))
      expect(r.out, bad).toMatch(/summaries: FAIL — line \d+: F1 form: .*#emph\[\[Summary: \.\.\.\]\] on one line/)
      expect(r.code, bad).toBe(1)
    }
  })
  test('F1: a canonical opener that does not close as ]] on its line fails', () => {
    const r = marks(put('#emph[[Summary: The court describes the escrow arrangements.]'))
    expect(r.out).toMatch(/line \d+: F1 form: a #emph\[\[Summary: opener that does not close as \]\]/)
    expect(r.code).toBe(1)
  })
  test('F1 does not trip on a court bracket like [S]ummary judgment', () => {
    expect(positional(t => t.replace('We affirm.', '[S]ummary judgment is not at issue. We affirm.'))).toContain('summaries: PASS — no editorial summary')
  })
  test('F2: a 41-word summary fails the cap', () => {
    const w = Array.from({ length: 41 }, (_, i) => (i ? 'word' : 'Word')).join(' ')
    const r = marks(put(`#emph[[Summary: ${w}.]]`))
    expect(r.out).toMatch(/line \d+: F2 cap: 41 words, more than 40/)
    expect(r.code).toBe(1)
  })
  test('F3: a summary inside a sentence fails', () => {
    const r = marks(t => t.replace('Investors were asked to identify a desired', 'Investors were asked to identify #emph[[Summary: The court lists the terms.]] a desired'))
    expect(r.out).toMatch(/line \d+: F3 position: inside a sentence/)
    expect(r.code).toBe(1)
  })
  test('F4: an elision mark beside the summary fails, on its line and as a line of its own', () => {
    const r = marks(put('#emph[[Summary: The court describes the escrow arrangements.]]', AT, AT + ' '))
    expect(r.out).toMatch(/line \d+: F4 double mark/)
    expect(r.code).toBe(1)
    const own = marks(put('\n\n#emph[[Summary: The court describes the escrow arrangements.]]', AT, AT))
    expect(own.out).toMatch(/line \d+: F4 double mark/)
    expect(own.code).toBe(1)
  })
  test('F5: a double quotation mark inside fails', () => {
    const r = marks(put('#emph[[Summary: The court describes the \\u{201C}term\\u{201D} of each investment.]]'))
    expect(r.out).toMatch(/line \d+: F5 quotes/)
    expect(r.code).toBe(1)
  })
  test('F6: a figure fails', () => {
    for (const fig of ['over 29 percent of', 'over \\$1 billion of', '4 million dollars of']) {
      const r = marks(put(`#emph[[Summary: The court describes ${fig} investor funds.]]`))
      expect(r.out, fig).toMatch(/line \d+: F6 figure/)
      expect(r.code, fig).toBe(1)
    }
  })
  test('F7: a holding word fails', () => {
    const r = marks(put('#emph[[Summary: The district court held that the contracts were securities.]]'))
    expect(r.out).toMatch(/line \d+: F7 holding: 'held'/)
    expect(r.code).toBe(1)
  })
  test('F8: a summary in the preamble fails', () => {
    const r = marks(t => t.replace('The reading follows on the next page.', 'The reading follows on the next page. #emph[[Summary: One reading follows.]]'))
    expect(r.out).toMatch(/line \d+: F8 placement: in the preamble/)
    expect(r.code).toBe(1)
  })
  test("F8: a summary on an editors'-note line fails", () => {
    const r = marks(t => t.replace('have been omitted. The footnotes', 'have been omitted. #emph[[Summary: The history is omitted.]] The footnotes'))
    expect(r.out).toMatch(/line \d+: F8 placement: on an editors'-note line/)
    expect(r.code).toBe(1)
  })
  test('check-quotes fails a summary carrying 8+ consecutive source words, printing the run', () => {
    const r = contract('check-quotes', project(put('#emph[[Summary: Here MBC recruited doctors to evaluate the health of an insured once more.]]')), ['addenda/a.typ'])
    expect(r.out).toContain('FAIL summary quotes the source')
    expect(r.out).toContain("'mbc recruited doctors to evaluate the health of'")
    expect(r.code).toBe(1)
  })
  test('a malformed summary is not masked: check-quotes still reports it as a MISS', () => {
    const r = contract('check-quotes', project(put('#emph[[Summary: The court then describes the escrow arrangements and the later course of the district court proceedings.]')), ['addenda/a.typ'])
    expect(r.out).toContain('MISS')
    expect(r.out).toContain('Summary: The court then describes')
    expect(r.out).toContain('0 editorial summary span(s) skipped as elisions')
    expect(r.out).not.toMatch(/[1-9]\d* editorial summary span\(s\) skipped/)
    expect(r.code).toBe(1)
  })
})
