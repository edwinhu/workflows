// Tests for jev-rank.ts — the refuter-ordering probe workflow.js shells out to, because the Workflow
// script sandbox has no network (probed 2026-09-28: fetch/process/require/crypto all undefined,
// import() rejected at parse).
//
// The transport is NOT exercised here: it is `decisionsCall` in hooks/work-hold.ts, shared with the
// work hold Stop hook, and a test that hit the live endpoint would fail on a machine with no key. What is
// tested is the batching and the parsing — the two places a wrong answer becomes a wrong ORDER.
//
// Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/jev-rank.test.ts
import { test, expect } from 'bun:test'
import { buildRequest, parseScores, findingState, REAL_DEFECT_QUESTION } from './jev-rank.ts'

const f = (over: any = {}) => ({ title: 't', severity: 'major', detail: 'd', lens: 'alpha', ...over })

test('one question per finding, keyed f<index>, in ONE request', () => {
  const { state, questions } = buildRequest([f({ title: 'a' }), f({ title: 'b' }), f({ title: 'c' })])
  expect(Object.keys(questions)).toEqual(['f0', 'f1', 'f2'])
  // Every finding is in the shared state, each behind its own label, so a question can name exactly one.
  for (const [i, t] of ['a', 'b', 'c'].entries()) {
    expect(state).toContain(`=== FINDING f${i} ===`)
    expect(state).toContain(t)
    expect(questions[`f${i}`].instructions).toContain(`"=== FINDING f${i} ==="`)
    expect(questions[`f${i}`].instructions).toContain(REAL_DEFECT_QUESTION)
    expect(questions[`f${i}`].type).toBe('noul')
  }
})

test('the state handed to Jev is the same three lines a refuter would have received', () => {
  // Not cosmetic: the 2026-09-27 AUC 0.639 measurement was taken against exactly this shape, and a
  // different one is an unmeasured judge.
  expect(findingState(f({ title: 'the title', file: 'src/x.py', detail: 'the detail' })))
    .toBe('Adversarially REFUTE this major review finding (lens alpha):\n  the title [src/x.py]\n  the detail')
})

test('a finding with no file omits the bracket rather than printing undefined', () => {
  expect(findingState(f())).not.toContain('[')
})

test('a finding with no lens is named, never left undefined', () => {
  expect(findingState({ title: 't', severity: 'minor', detail: 'd' })).toContain('lens unattributed')
})

test('parseScores returns one entry per input index, in order', () => {
  const out = parseScores(JSON.stringify({ answers: { f0: { noul: 0.8 }, f1: { noul: 0.2 } } }), 2)
  expect(out).toEqual([{ index: 0, p: 0.8 }, { index: 1, p: 0.2 }])
})

test('a missing answer is null, never 0 — 0 would read as "certainly not a defect"', () => {
  const out = parseScores(JSON.stringify({ answers: { f1: { noul: 0.5 } } }), 3)
  expect(out).toEqual([{ index: 0, p: null }, { index: 1, p: 0.5 }, { index: 2, p: null }])
})

test('a non-numeric or non-finite noul is null, not coerced', () => {
  for (const bad of ['0.8', null, {}, [], true]) {
    expect(parseScores(JSON.stringify({ answers: { f0: { noul: bad }, f1: { noul: 0.5 } } }), 2)![0].p).toBe(null)
  }
})

test('an all-null reply is UNAVAILABLE (null), not a ranking that is silently the input order', () => {
  expect(parseScores(JSON.stringify({ answers: {} }), 3)).toBe(null)
  expect(parseScores(JSON.stringify({ answers: { f0: {}, f1: {} } }), 2)).toBe(null)
})

test('unparseable or shapeless replies return null rather than throwing', () => {
  for (const bad of ['', 'not json', '{}', '{"error":"boom"}', 'null', '[]']) {
    expect(parseScores(bad, 2)).toBe(null)
  }
})

test('a real Decisions reply shape parses — captured from the live endpoint 2026-09-28', () => {
  // Extra keys the API carries (id, usage) must not disturb the answer lookup.
  const live = JSON.stringify({
    id: 'dec_x', model: 'typesafe/jev-1.13',
    answers: { f0: { noul: 0.4 }, f1: { noul: 0.04 } },
    usage: { cost: 0.0000255 },
  })
  expect(parseScores(live, 2)).toEqual([{ index: 0, p: 0.4 }, { index: 1, p: 0.04 }])
})
