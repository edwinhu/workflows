// The watcher mod (hooks/register.ts) under the mod kit: `claude plugin test hooks/mod-tests` from
// the plugin root. No real file, process or store is touched: a fake tree answers $.fs, a fake ps
// answers $.process.run, and the store is a Map that outlives one test, which is what a reload is.
import { expect, mock, test } from 'claude-code/testing'

const SID = 'S1'
const ROOT = '/tmpx'
const T0 = 1_800_000_000 // START t=, epoch seconds
const NOW = T0 * 1000 + 43 * 60_000

type Tree = Record<string, string>

const dir = (sid: string) => `${ROOT}/farm-events/${sid}`

/** A farm session: alpha running, beta finished ok with its report written, gamma killed with its
 *  artifact missing, and another session's run that this one must never show or wake for. */
function farmTree(): Tree {
  return {
    [`${dir(SID)}/100.ndjson`]:
      `farm: START alpha cwd=/w out= expect=1 t=${T0}\nfarm: CLAIM alpha path=/w/alpha.md \n`,
    [`${dir(SID)}/200.ndjson`]:
      `farm: START beta cwd=/w out= expect=1 t=${T0 + 600}\nfarm: CLAIM beta path=/w/beta.md \n` +
      `farm: DONE beta ok toolCalls=12 W=900\n`,
    [`${dir(SID)}/400.ndjson`]:
      `farm: START gamma cwd=/w out= expect=1 t=${T0 + 60}\nfarm: CLAIM gamma path=/w/gamma.md \n`,
    [`${dir('OTHER')}/300.ndjson`]:
      `farm: START theirs cwd=/w out= expect=1 t=${T0}\nfarm: DONE theirs ok toolCalls=1 W=1\n`,
    '/w/beta.md': '# report',
  }
}

/** A work run with a detached loop that finished: the loop wakes, its round and nested rows do not. */
function workTree(): Tree {
  const R = '/w/.work/runs/1001-x'
  return {
    [`${dir(SID)}/500.ndjson`]:
      `farm: START work-round cwd=/w out=${R}/result.json expect=1 t=${T0}\n` +
      `farm: CLAIM work-round path=${R}/result.json \nfarm: DONE work-round ok\n`,
    [`${dir(SID)}/501.ndjson`]:
      `farm: START workflow cwd=/w out=${R}/raw.json expect=1 t=${T0}\nfarm: DONE workflow ok toolCalls=3 W=9\n`,
    [`${dir(SID)}/502.ndjson`]:
      `farm: START work-loop cwd=/w out=${R}/loop.exit expect=1 t=${T0}\nfarm: DONE work-loop rc=0\n`,
    [`${R}/result.json`]: '{}',
    [`${R}/raw.json`]: '{}',
    [`${R}/loop.exit`]: '0\n',
    [`${R}/loop.log`]: 'work-loop: round 1 of 3 — waiting\nwork-loop: PASS on round 1\n',
    [`${R}/run.log`]: '\nwork-round: 1/5 agents (farm.sh --workflow)\n\nwork-round: 2/5 checks (work-checks.sh)\n',
  }
}

/** A work round still running with no loop: the status line names its round phase. */
function liveWorkTree(): Tree {
  const R = '/w/.work/runs/1002-y'
  return {
    [`${dir(SID)}/600.ndjson`]:
      `farm: START work-round cwd=/w out=${R}/result.json expect=1 t=${T0 + 37 * 60}\n` +
      `farm: CLAIM work-round path=${R}/result.json \n`,
    [`${R}/run.log`]: 'work-round: 1/5 agents (farm.sh --workflow)\nwork-round: 2/5 checks (work-checks.sh)\n',
  }
}

type Seen = { submits: string[]; statuses: (string | undefined)[]; commands: string[]; timers: number }

function world(on: any, tree: Tree, opts: { alive?: number[]; store?: Map<string, unknown> } = {}) {
  const seen: Seen = { submits: [], statuses: [], commands: [], timers: 0 }
  const store = opts.store ?? new Map<string, unknown>()
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { TMPDIR: ROOT })
  on('session.start', () => ({ cwd: '/w' }))
  on('session.id', () => ({ value: SID }))
  on('command.register', ($: any, e: any) => { seen.commands.push(e.name); return { value: undefined } })
  on('ui.status', ($: any, e: any) => { seen.statuses.push(e.text); return { value: undefined } })
  on('prompt.submit', ($: any, e: any) => { seen.submits.push(e.text); return { text: e.text } })
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('fs.list', ($: any, e: any) => {
    const prefix = e.path.replace(/\/+$/, '') + '/'
    const names = Object.keys(tree).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))
    if (!names.length) return { deny: `ENOENT ${e.path}` }
    const direct = [...new Set(names.map(n => n.split('/')[0]))]
    return { value: direct.map(n => ({ name: n, kind: 'file', size: (tree[prefix + n] ?? '').length, mtimeMs: NOW - 1000, isLink: false })) }
  })
  on('fs.read', ($: any, e: any) => (e.path in tree ? { value: tree[e.path] } : { deny: `ENOENT ${e.path}` }))
  on('fs.stat', ($: any, e: any) =>
    (e.path in tree ? { value: { kind: 'file', size: tree[e.path]!.length, mtimeMs: NOW, isLink: false } } : { deny: `ENOENT ${e.path}` }))
  on('process.run', ($: any, e: any) => {
    const asked = String(e.argv.at(-1)).split(',').map(Number)
    const live = asked.filter(p => (opts.alive ?? []).includes(p))
    return { value: { exitCode: live.length ? 0 : 1, stdout: live.map(p => `  ${p}\n`).join(''), stderr: '' } }
  })
  return { seen, clock, store }
}

async function start($: any, isInteractive = true) {
  await $.session.start({ surface: isInteractive ? 'terminal' : null, isInteractive, cwd: '/w' })
}

// Shared across the two tests below: the second is the module reloaded with the first's store.
const reloadStore = new Map<string, unknown>()

test('DONE and GONE each wake once; another session\'s run never wakes', async ($, on) => {
  const { seen, clock } = world(on, farmTree(), { alive: [100], store: reloadStore })
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(2)
  const beta = seen.submits.find(s => s.includes('beta'))!
  expect(beta).toContain('farm run beta finished: ok toolCalls=12 W=900 after 33m')
  expect(beta).toContain('Report: /w/beta.md (present)')
  const gamma = seen.submits.find(s => s.includes('gamma'))!
  expect(gamma).toContain('farm run gamma is GONE: pid 400 exited with no DONE line after 42m')
  expect(gamma).toContain('expected artifact missing: /w/gamma.md')
  expect(seen.submits.some(s => s.includes('theirs'))).toBe(false)
  expect(seen.submits.some(s => s.includes('alpha'))).toBe(false)
})

test('after a reload the store keeps a finished run from waking again', async ($, on) => {
  const { seen, clock } = world(on, farmTree(), { alive: [100], store: reloadStore })
  expect([...reloadStore.keys()].filter(k => k.startsWith('notified:')).length).toBe(2)
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  expect(seen.submits).toEqual([])
})

test('the status line names the running runs, and /farm lists only this session\'s', async ($, on) => {
  const { seen, clock } = world(on, farmTree(), { alive: [100] })
  await start($)
  await clock.settle()
  expect(seen.statuses.at(-1)).toBe('farm: 1 running (alpha 43m)')
  expect(seen.commands).toEqual(['farm'])
  const out = await $.command.run({ command: 'farm', args: '' })
  const lines = out.text!.split('\n')
  expect(lines[0]).toMatch(/^run\s+state\s+elapsed\s+artifact\s+report$/)
  expect(out.text).toMatch(/alpha\s+running\s+43m\s+missing\s+\/w\/alpha\.md/)
  expect(out.text).toMatch(/beta\s+done ok\s+33m\s+present\s+\/w\/beta\.md/)
  expect(out.text).toMatch(/gamma\s+GONE\s+42m\s+missing\s+\/w\/gamma\.md/)
  expect(out.text).not.toContain('theirs')
})

test('the status line clears when nothing is running', async ($, on) => {
  const tree = farmTree()
  const { seen, clock } = world(on, tree, { alive: [100] })
  await start($)
  await clock.settle()
  expect(seen.statuses.at(-1)).toBe('farm: 1 running (alpha 43m)')
  // alpha finishes: its DONE line lands, and the next tick clears the line
  tree[`${dir(SID)}/100.ndjson`] += 'farm: DONE alpha ok toolCalls=4 W=10\n'
  tree['/w/alpha.md'] = '# alpha'
  await clock.advance(15_000)
  expect(seen.statuses.at(-1)).toBeUndefined()
  expect(seen.submits.some(s => s.startsWith('farm run alpha finished: ok toolCalls=4'))).toBe(true)
})

test('a work run wakes once through its loop; its round and nested rows stay quiet', async ($, on) => {
  const { seen, clock } = world(on, workTree(), { alive: [] })
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(1)
  expect(seen.submits[0]).toContain('work run 1001-x loop finished: exit 0 (gate passed)')
  expect(seen.submits[0]).toContain('Result: /w/.work/runs/1001-x/result.json')
  const out = await $.command.run({ command: 'farm', args: '' })
  expect(out.text).toContain('↳ workflow')
})

test('a live work round shows its round phase in the status line', async ($, on) => {
  const { seen, clock } = world(on, liveWorkTree(), { alive: [600] })
  await start($)
  await clock.settle()
  expect(seen.statuses.at(-1)).toBe('work 1002-y 2/5 checks 6m')
  expect(seen.submits).toEqual([])
})

test('a headless session registers nothing that wakes or draws', async ($, on) => {
  const { seen, clock } = world(on, farmTree(), { alive: [100] })
  await start($, false)
  await clock.settle()
  await clock.advance(60_000)
  expect(seen.commands).toEqual([])
  expect(seen.statuses).toEqual([])
  expect(seen.submits).toEqual([])
})

test('a farm child (FARM_OUT_CHILD=1) registers nothing either', async ($, on) => {
  const seen: string[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { FARM_OUT_CHILD: '1', TMPDIR: ROOT })
  on('session.start', () => ({ cwd: '/w' }))
  on('command.register', ($: any, e: any) => { seen.push(e.name); return { value: undefined } })
  on('ui.status', ($: any, e: any) => { seen.push(String(e.text)); return { value: undefined } })
  await start($)
  await clock.advance(60_000)
  expect(seen).toEqual([])
})
