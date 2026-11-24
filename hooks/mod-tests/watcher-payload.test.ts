// The watcher's wake is one terse line: a finished farm row names its report path, a finished work loop
// carries its verdict from result.json (PASS / FAIL / unreadable), and nothing is ever read out of a
// report file. Same fake world as watcher.test.ts.
import { expect, mock, test } from 'claude-code/testing'

const SID = 'S1'
const ROOT = '/tmpx'
const T0 = 1_800_000_000
const NOW = T0 * 1000 + 43 * 60_000

type Tree = Record<string, string>

const dir = (sid: string) => `${ROOT}/farm-events/${sid}`

function world(on: any, tree: Tree) {
  const submits: string[] = []
  const store = new Map<string, unknown>()
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { TMPDIR: ROOT })
  on('session.start', () => ({ cwd: '/w' }))
  on('session.id', () => ({ value: SID }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', ($: any, e: any) => { submits.push(e.text); return { text: e.text } })
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('fs.list', ($: any, e: any) => {
    const prefix = e.path.replace(/\/+$/, '') + '/'
    const names = Object.keys(tree).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))
    if (!names.length) return { deny: `ENOENT ${e.path}` }
    const direct = [...new Set(names.map(n => n.split('/')[0]))]
    return { value: direct.map(n => ({ name: n, kind: 'file', size: (tree[prefix + n] ?? '').length, mtimeMs: NOW - 1000, isLink: false })) }
  })
  on('fs.read', ($: any, e: any) => (e.path in tree ? { value: tree[e.path] } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', ($: any, e: any) => { tree[e.path] = e.text; return { value: undefined } })
  on('fs.stat', ($: any, e: any) =>
    (e.path in tree ? { value: { kind: 'file', size: tree[e.path]!.length, mtimeMs: NOW, isLink: false } } : { deny: `ENOENT ${e.path}` }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  return { submits, clock }
}

async function settle($: any, clock: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await clock.settle()
  await clock.advance(15_000)
}

/** One finished farm row whose expected report is `report`. */
function farmRow(report: string): Tree {
  return {
    [`${dir(SID)}/200.ndjson`]:
      `farm: START beta cwd=/w out= expect=1 t=${T0}\nfarm: CLAIM beta path=/w/beta.md \nfarm: DONE beta ok toolCalls=12 W=900\n`,
    '/w/beta.md': report,
  }
}

/** A farm row whose process died with no DONE line and no artifact. */
function goneRow(): Tree {
  return {
    [`${dir(SID)}/300.ndjson`]:
      `farm: START lost cwd=/w out= expect=1 t=${T0}\nfarm: CLAIM lost path=/w/lost.md \n`,
  }
}

/** One finished work loop whose result.json is `result`. */
function workLoop(result: string): Tree {
  const R = '/w/.work/runs/1001-x'
  return {
    [`${dir(SID)}/502.ndjson`]:
      `farm: START work-loop cwd=/w out=${R}/loop.exit expect=1 t=${T0}\nfarm: DONE work-loop rc=0\n`,
    [`${R}/result.json`]: result,
    [`${R}/loop.exit`]: '0\n',
    [`${R}/loop.log`]: 'work-loop: PASS on round 1\n',
  }
}

const RESULT = '/w/.work/runs/1001-x/result.json'

test('a finished farm row wakes with its report path and none of the report text', async ($, on) => {
  const report = Array.from({ length: 20 }, (_, i) => `REPORT-LINE-${i + 1}`).join('\n') + '\n'
  const { submits, clock } = world(on, farmRow(report))
  await settle($, clock)
  expect(submits).toEqual(['farm beta: ok, 43m · report /w/beta.md'])
  expect(submits[0]).not.toContain('REPORT-LINE')
})

test('a finished work loop wakes with its FAIL verdict and no flagged-task detail', async ($, on) => {
  const result = JSON.stringify({
    overallPass: false, tasksThatFlagged: ['T1', 'T3'], mechanicalThatFailed: [{ name: 'dev', exitCode: 1 }],
    lensesThatFlagged: [], rulesThatFailed: ['WEAK'],
  })
  const { submits, clock } = world(on, workLoop(result))
  await settle($, clock)
  expect(submits).toEqual([`work 1001-x: FAIL, exit 0 (gate passed), 43m · result ${RESULT}`])
})

test('a verdict wrapped under .result is unwrapped', async ($, on) => {
  const result = JSON.stringify({ summary: 'x', result: {
    overallPass: true, tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: [], rulesThatFailed: [] } })
  const { submits, clock } = world(on, workLoop(result))
  await settle($, clock)
  expect(submits).toEqual([`work 1001-x: PASS, exit 0 (gate passed), 43m · result ${RESULT}`])
})

test('an unparseable result.json says so instead of guessing a verdict', async ($, on) => {
  const { submits, clock } = world(on, workLoop('{not json'))
  await settle($, clock)
  expect(submits).toEqual([`work 1001-x: result.json unreadable, exit 0 (gate passed), 43m · result ${RESULT}`])
})

test('a GONE farm row and a finished work loop each wake with a single bare line', async ($, on) => {
  const { submits, clock } = world(on, { ...goneRow(), ...workLoop(JSON.stringify({ overallPass: true })) })
  await settle($, clock)
  expect(submits.length).toBe(2)
  expect(submits.find(s => s.startsWith('farm lost:'))).toBe('farm lost: GONE after 43m (no DONE line) · expected /w/lost.md missing')
  expect(submits.find(s => s.startsWith('work 1001-x:'))).toBe(`work 1001-x: PASS, exit 0 (gate passed), 43m · result ${RESULT}`)
  for (const s of submits) expect(s).not.toMatch(/\n|W=|toolCalls=|events:|--- /)
})
