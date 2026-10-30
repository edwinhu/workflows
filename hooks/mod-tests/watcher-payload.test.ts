// The watcher's wake carries the outcome: the head of a finished farm row's report, or a finished work
// loop's verdict from result.json, so one wake is enough to act on. Same fake world as watcher.test.ts.
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

test('a finished farm row wakes with the first 15 lines of its report and a count of the rest', async ($, on) => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
  const { submits, clock } = world(on, farmRow(lines.join('\n') + '\n'))
  await settle($, clock)
  expect(submits.length).toBe(1)
  const s = submits[0]!
  expect(s).toContain('farm run beta finished: ok toolCalls=12 W=900')
  expect(s).toContain('--- /w/beta.md, first 15 lines ---\nline 1\nline 2\n')
  expect(s).toContain('\nline 15\n')
  expect(s).not.toContain('line 16')
  expect(s).toContain('(… 5 more lines)')
})

test('a report line longer than 200 characters is cut with an ellipsis', async ($, on) => {
  const { submits, clock } = world(on, farmRow('x'.repeat(300) + '\nshort\n'))
  await settle($, clock)
  const s = submits[0]!
  expect(s).toContain('x'.repeat(200) + '…')
  expect(s).not.toContain('x'.repeat(201))
  expect(s).toContain('\nshort')
})

test('a binary report is named by size, never pasted', async ($, on) => {
  const bin = 'PK\u0003\u0004\u0000\u0000garbage'
  const { submits, clock } = world(on, farmRow(bin))
  await settle($, clock)
  const s = submits[0]!
  expect(s).toContain(`(binary, ${bin.length} bytes)`)
  expect(s).not.toContain('garbage')
})

test('a finished work loop wakes with its verdict from result.json', async ($, on) => {
  const result = JSON.stringify({
    overallPass: false, tasksThatFlagged: ['T1', 'T3'], mechanicalThatFailed: [{ name: 'dev', exitCode: 1 }],
    lensesThatFlagged: [], rulesThatFailed: ['WEAK'],
  })
  const { submits, clock } = world(on, workLoop(result))
  await settle($, clock)
  expect(submits.length).toBe(1)
  expect(submits[0]).toContain('work run 1001-x loop finished: exit 0 (gate passed)')
  expect(submits[0]).toContain('Verdict: FAIL · flagged tasks: T1, T3 · failed checks: dev · lenses flagged: none · rules failed: WEAK')
})

test('a verdict wrapped under .result is unwrapped', async ($, on) => {
  const result = JSON.stringify({ summary: 'x', result: {
    overallPass: true, tasksThatFlagged: [], mechanicalThatFailed: [], lensesThatFlagged: [], rulesThatFailed: [] } })
  const { submits, clock } = world(on, workLoop(result))
  await settle($, clock)
  expect(submits[0]).toContain('Verdict: PASS · flagged tasks: none · failed checks: none · lenses flagged: none · rules failed: none')
})

test('an unparseable result.json says so instead of guessing a verdict', async ($, on) => {
  const { submits, clock } = world(on, workLoop('{not json'))
  await settle($, clock)
  expect(submits.length).toBe(1)
  expect(submits[0]).toContain('Verdict: result.json unreadable')
  expect(submits[0]).not.toContain('Verdict: PASS')
})
