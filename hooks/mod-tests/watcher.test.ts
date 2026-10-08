// The watcher mod (hooks/watch/watcher.ts, entered through hooks/register.ts) under the mod kit: `claude plugin test hooks/mod-tests` from
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

type Seen = { submits: string[]; statuses: (string | undefined)[]; commands: string[]; timers: number; runs: string[][] }

function world(on: any, tree: Tree, opts: { alive?: number[]; store?: Map<string, unknown>; mtimes?: Record<string, number> } = {}) {
  const seen: Seen = { submits: [], statuses: [], commands: [], timers: 0, runs: [] }
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
  // the engine's own AbovePrompt: nothing of its own, so a plugin's band is the whole band
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('fs.list', ($: any, e: any) => {
    const prefix = e.path.replace(/\/+$/, '') + '/'
    const names = Object.keys(tree).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))
    if (!names.length) return { deny: `ENOENT ${e.path}` }
    const direct = [...new Set(names.map(n => n.split('/')[0]))]
    return { value: direct.map(n => ({ name: n, kind: 'file', size: (tree[prefix + n] ?? '').length, mtimeMs: opts.mtimes?.[prefix + n] ?? NOW - 1000, isLink: false })) }
  })
  on('fs.read', ($: any, e: any) => (e.path in tree ? { value: tree[e.path] } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', ($: any, e: any) => { tree[e.path] = e.text; return { value: undefined } })
  on('fs.stat', ($: any, e: any) =>
    (e.path in tree ? { value: { kind: 'file', size: tree[e.path]!.length, mtimeMs: opts.mtimes?.[e.path] ?? NOW, isLink: false } } : { deny: `ENOENT ${e.path}` }))
  on('process.run', ($: any, e: any) => {
    seen.runs.push(e.argv)
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

test('every tick rewrites the session\'s beacon, which is how a hook tells the watcher runs here', async ($, on) => {
  const tree = farmTree()
  const { clock } = world(on, tree, { alive: [100] })
  await start($)
  await clock.settle()
  expect(tree[`${dir(SID)}/watcher.alive`]).toBe(String(Math.floor(NOW / 1000)))
  await clock.advance(15_000)
  expect(tree[`${dir(SID)}/watcher.alive`]).toBe(String(Math.floor(NOW / 1000) + 15))
  // Written for this session only; another session's directory gets no beacon from us.
  expect(`${dir('OTHER')}/watcher.alive` in tree).toBe(false)
})

test('a headless session writes no beacon: no watcher runs there', async ($, on) => {
  const tree = farmTree()
  const { clock } = world(on, tree, { alive: [100] })
  await start($, false)
  await clock.settle()
  await clock.advance(60_000)
  expect(`${dir(SID)}/watcher.alive` in tree).toBe(false)
})

// The secreg session e3b75752 (2026-10-02): its slides diagnose 1002-slides-18-diag, verbatim from
// $TMPDIR/farm-events/e3b75752-…/{2656363,2656379,2657005,2697872}.ndjson. The work-loop's DONE rc=3
// landed at 22:09:45 and no wake reached the session — because the session loaded no mods at all, not
// because these lines are mis-read: with the watcher running they wake it exactly once.
test('secreg 1002-slides-18-diag: the loop\'s DONE rc=3 wakes once; its round, workflow and lens rows do not', async ($, on) => {
  const R = '/home/eh/.local/state/craft/1002-slides-18-diag'
  const D = dir('e3b75752-8459-4201-8118-4b52c8e0bc9c')
  const tree: Tree = {
    [`${D}/2656363.ndjson`]:
      `farm: START work-round cwd=/home/eh/areas/secreg out=${R}/result.json expect=1 t=1790992951\n` +
      `farm: CLAIM work-round path=${R}/result.json \nfarm: DONE work-round ok\n`,
    [`${D}/2656379.ndjson`]:
      `farm: START workflow cwd=/home/eh/areas/secreg out=${R}/raw.json expect=1 t=1790992951\n` +
      `farm: CLAIM workflow path=${R}/raw.json \nfarm: CLAIM workflow path=${R}/raw.json \n` +
      `farm: DONE workflow ok toolCalls=4 W=0\n`,
    [`${D}/2657005.ndjson`]:
      `farm: START work-loop cwd=/home/eh/areas/secreg out=${R}/loop.exit expect=1 t=1790992953\n` +
      `farm: DONE work-loop rc=3\n`,
    [`${D}/2697872.ndjson`]:
      `farm: START lens cwd=/home/eh/areas/secreg out= expect=1 t=1790993251\n` +
      `farm: CLAIM lens path=${R}/lens.json \nfarm: DONE lens ok toolCalls=23 W=0\n`,
    [`${R}/result.json`]: '{}', [`${R}/raw.json`]: '{}', [`${R}/lens.json`]: '{}', [`${R}/loop.exit`]: '3\n',
  }
  const seen: string[] = []
  // 22:09:50 EDT, five seconds after the DONE line.
  const clock = mock.clock(on, { now: 1790993390_000 })
  mock.env(on, { TMPDIR: ROOT })
  on('session.start', () => ({ cwd: '/home/eh/areas/secreg' }))
  on('session.id', () => ({ value: 'e3b75752-8459-4201-8118-4b52c8e0bc9c' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', ($: any, e: any) => { seen.push(e.text); return { text: e.text } })
  const store = new Map<string, unknown>()
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($: any, e: any) => { store.delete(e.key); return { value: undefined } })
  on('fs.list', ($: any, e: any) => {
    const prefix = e.path.replace(/\/+$/, '') + '/'
    const names = Object.keys(tree).filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split('/')[0]!)
    if (!names.length) return { deny: `ENOENT ${e.path}` }
    return { value: [...new Set(names)].map(n => ({ name: n, kind: 'file', size: (tree[prefix + n] ?? '').length, mtimeMs: 1790993385_000, isLink: false })) }
  })
  on('fs.read', ($: any, e: any) => (e.path in tree ? { value: tree[e.path] } : { deny: `ENOENT ${e.path}` }))
  on('fs.stat', ($: any, e: any) =>
    (e.path in tree ? { value: { kind: 'file', size: tree[e.path]!.length, mtimeMs: 1790993385_000, isLink: false } } : { deny: `ENOENT ${e.path}` }))
  on('fs.write', ($: any, e: any) => { tree[e.path] = e.text; return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  expect(seen.length).toBe(1)
  expect(seen[0]).toContain('work run 1002-slides-18-diag loop finished: exit 3 (redispatch refused at Tier 1) after 7m.')
  expect([...store.keys()]).toEqual(['notified:e3b75752-8459-4201-8118-4b52c8e0bc9c:2657005:0:work-loop:1790992953'])
  expect(tree[`${D}/watcher.alive`]).toBe('1790993405')
})

/** The credit-warn cache with a day of hourly samples spending $3.40/day, newest at NOW, $19.77 left. */
function creditsTree(perDay = 3.4, last = 19.77): Tree {
  const samples: [number, number][] = []
  for (let i = 24; i >= 0; i--) samples.push([NOW - i * 3_600_000, +(last + (i * perDay) / 24).toFixed(6)])
  return { [`${ROOT}/openrouter-credits.json`]: JSON.stringify({ checkedAt: NOW, balance: last, samples }) }
}

const band = (hasSurvey = false) => ({
  plugin: 'workflows', surface: 'terminal' as const, component: 'AbovePrompt' as const,
  props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9, contentRows: 1 } } as any,
})

test('the Jev forecast band: the tick samples through credit-warn, the band draws the cache', async ($, on) => {
  const { seen, clock } = world(on, creditsTree())
  await start($)
  await clock.settle()
  expect(seen.runs.filter(a => a.includes('--sample')).map(a => a.slice(-2).join(' ')))
    .toEqual([`${seen.runs.find(a => a.includes('--sample'))![1]} --sample`])
  expect(seen.runs.find(a => a.includes('--sample'))![1]).toMatch(/\/scripts\/lib\/openrouter-credits\.ts$/)
  const ui = await $.ui.mount(band())
  expect((await ui.find({ type: 'Text', text: /^Jev / }))?.text).toBe('Jev $19.77 · $3.40/day · ~6 days')
  await ui.unmount()
  // the next sample is ten minutes on, not every watcher tick
  await clock.advance(15_000)
  expect(seen.runs.filter(a => a.includes('--sample')).length).toBe(1)
  await clock.advance(10 * 60_000)
  expect(seen.runs.filter(a => a.includes('--sample')).length).toBe(2)
})

test('the Jev forecast band names an empty account', async ($, on) => {
  const out = world(on, creditsTree(3.4, -0.24))
  await start($)
  await out.clock.settle()
  const ui = await $.ui.mount(band())
  expect((await ui.find({ type: 'Text', text: /OUT OF CREDITS/ }))?.text)
    .toBe('Jev OUT OF CREDITS — top up at https://openrouter.ai/settings/credits (balance -$0.24)')
  await ui.unmount()
})

test('the Jev forecast band stays away with no samples (a cache from before the samples)', async ($, on) => {
  const { seen, clock } = world(on, { [`${ROOT}/openrouter-credits.json`]: JSON.stringify({ checkedAt: NOW, balance: 19.77 }) })
  await start($)
  await clock.settle()
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^Jev / })).toBeUndefined()
  await ui.unmount()
  expect(seen.runs.filter(a => a.includes('--sample')).length).toBe(1)
})

test('a headless session never samples credits', async ($, on) => {
  const { seen, clock } = world(on, creditsTree())
  await start($, false)
  await clock.settle()
  expect(seen.runs.filter(a => a.includes('--sample'))).toEqual([])
})

// hidden-figures 1004-published-apps (2026-10-04): a dead loop left loop.exit=1; ten seconds after the
// re-dispatch the watcher read it as the NEW loop's verdict and woke the session with a false failure.
test('a loop.exit older than the loop\'s START never classifies the live loop as finished', async ($, on) => {
  const R = '/w/.work/runs/1004-x'
  const tree: Tree = {
    [`${dir(SID)}/700.ndjson`]: `farm: START work-loop cwd=/w out=${R}/loop.exit expect=1 t=${T0}\n`,
    [`${R}/loop.exit`]: '1\n',
    [`${R}/loop.log`]: 'work-loop: round 1 of 3 — waiting\n',
  }
  const { seen, clock } = world(on, tree, { alive: [700], mtimes: { [`${R}/loop.exit`]: (T0 - 3600) * 1000 } })
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  expect(seen.submits).toEqual([])
  expect(seen.statuses.at(-1)).toContain('work 1004-x round 1/3')
})

test('a live grind loop\'s WAIT wakes once per new waits value, never twice for the same one', async ($, on) => {
  const G = `${dir(SID)}/700.ndjson`
  const head = `grind: START grind%20j.jsonl cwd=/w journal=/w/j.jsonl t=${T0} \n`
  const wait = (n: number) => `grind: WAIT grind%20j.jsonl waits=${n} why=grid%20busy script=/p/grind.sh \n`
  const tree: Tree = { [G]: head + wait(2) }
  const { seen, clock } = world(on, tree, { alive: [700] })
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  expect(seen.submits).toEqual([
    'grind loop grind j.jsonl waiting: 2 consecutive gate waits, still running. Why: grid busy. Status: bash /p/grind.sh status --journal /w/j.jsonl',
  ])
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(1)
  tree[G] += wait(4)
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(2)
  expect(seen.submits[1]).toContain('waiting: 4 consecutive gate waits')
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(2)
  // still live: no DONE-style wake
  expect(seen.statuses.at(-1)).toContain('grind j.jsonl')
})

const DAY = 24 * 3600_000
const OLD = `grind: START grind%20j.jsonl cwd=/w journal=/w/j.jsonl t=${T0 - 3 * 86400} \n`

test('a grind started 3 days ago with a fresh DONE wakes once', async ($, on) => {
  const tree: Tree = { [`${dir(SID)}/710.ndjson`]: OLD + 'grind: DONE done rc=0\n' }
  const { seen, clock } = world(on, tree)
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(1)
  expect(seen.submits[0]).toContain('grind j.jsonl')
})

test('a fresh WAIT on a 3-day-old live grind wakes once', async ($, on) => {
  const tree: Tree = { [`${dir(SID)}/711.ndjson`]: OLD + 'grind: WAIT grind%20j.jsonl waits=6 why=grid%20busy script=/p/grind.sh \n' }
  const { seen, clock } = world(on, tree, { alive: [711] })
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(seen.submits.length).toBe(1)
  expect(seen.submits[0]).toContain('waiting: 6 consecutive gate waits')
})

test('a stale event file from a long-dead grind session wakes nobody', async ($, on) => {
  const f = `${dir(SID)}/712.ndjson`
  const tree: Tree = { [f]: OLD + 'grind: DONE done rc=0\n' }
  const { seen, clock } = world(on, tree, { mtimes: { [f]: NOW - 2 * DAY } })
  await start($)
  await clock.settle()
  await clock.advance(15_000)
  expect(seen.submits).toEqual([])
})
