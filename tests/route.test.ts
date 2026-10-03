import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { loadTable, route } from '../scripts/lib/route.ts'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

/**
 * The spec for scripts/lib/route.ts: one row in, one routing decision out.
 *
 * Routing makes no Decisions call (the Jev shadow was retired 2026-10-02); the stub Decisions server
 * below is only there to prove it is never asked. --outcomes reports over a temp outcomes file.
 */

const ROOT = join(import.meta.dir, '..')
const ROUTE = join(ROOT, 'scripts', 'lib', 'route.ts')
const FIXTURE = join(import.meta.dir, 'fixtures', 'routing', 'table.json')
const COMMITTED = join(ROOT, 'scripts', 'lib', 'routing.json')
/** Nothing listens here: curl cannot connect, so Jev is unavailable without any network. */
const DEAD = 'http://127.0.0.1:1/'
const KINDS = ['script', 'judgement', 'review', 'bulk']
const CANDIDATES = ['sonnet', 'opus', 'flash', 'luna']

/** A copy of the fixture with `edit` applied, written to a fresh temp dir. */
function fixtureCopy(edit: (t: any) => void): string {
  const t = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  edit(t)
  const p = join(mkTmp('route-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2))
  return p
}

type Run = { code: number; stdout: string; stderr: string; ms: number }

async function runCli(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const { WORK_HOLD_DECISIONS_MODEL: _m, ROUTING_TABLE: _t, ...base } = HERMETIC_ENV
  const t0 = Date.now()
  const p = Bun.spawn(['bun', ROUTE, ...args], {
    env: { ...base, WORK_HOLD_DECISIONS_URL: DEAD, WORK_HOLD_JUDGE_TOKEN: 'test-token', ...env },
    stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 20_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr, ms: Date.now() - t0 }
}

const decide = (row: object, table = FIXTURE, env: Record<string, string> = {}) =>
  runCli(['--row', JSON.stringify(row), '--table', table], env)

function parseDecision(r: Run) {
  expect(r.stderr).not.toContain('not implemented')
  expect(r.code).toBe(0)
  const lines = r.stdout.trim().split('\n')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0])
}

/** A stub Decisions server. `answer(body)` builds the reply; every request body is recorded. */
function stubJev(answer: (body: any) => Response | Promise<Response>) {
  const bodies: any[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const text = await req.text()
      let body: any = text
      try { body = JSON.parse(text) } catch { /* recorded raw */ }
      bodies.push(body)
      return answer(body)
    },
  })
  return { url: `http://127.0.0.1:${server.port}/`, bodies, stop: () => server.stop(true) }
}

/** A Decisions reply giving each candidate `scores[id]` as P(CORRECT). */
const scoresReply = (scores: Record<string, number>) => () =>
  new Response(JSON.stringify({
    answers: Object.fromEntries(Object.entries(scores).map(([id, p]) => [
      `q_${id}`, { type: 'choice', choice: p >= 0.5 ? 'CORRECT' : 'WRONG', probabilities: { CORRECT: p, WRONG: 1 - p } },
    ])),
  }), { headers: { 'content-type': 'application/json' } })

// ------------------------------------------------------------------------------ the API

test('loadTable reads the fixture table', () => {
  const t = loadTable(FIXTURE)
  expect(Object.keys(t.candidates).sort()).toEqual([...CANDIDATES].sort())
  expect(t.kinds.script).toEqual({ pick: 'sonnet', fallbacks: ['flash'] })
})

test('route() passes an explicit provider and model through verbatim', async () => {
  const d = await route({ prompt: 'p', provider: 'codex', model: 'gpt-5.6-luna' }, { table: loadTable(FIXTURE) })
  expect(d.source).toBe('explicit')
  expect(d.provider).toBe('codex')
  expect(d.model).toBe('gpt-5.6-luna')
})

// ------------------------------------------------------------------------- explicit rows

test('a row with provider and model is explicit and never consults Jev', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.9, flash: 0.9, luna: 0.9 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', provider: 'codex', model: 'gpt-5.6-luna' }, FIXTURE,
      { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna', source: 'explicit' })
    expect(jev.bodies).toHaveLength(0)
  } finally { jev.stop() }
}, 30_000)

test('an explicit provider/model wins even when the row also names a kind', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.9, flash: 0.9, luna: 0.9 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'script', provider: 'codex', model: 'gpt-5.6-luna' },
      FIXTURE, { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna', source: 'explicit' })
    expect(jev.bodies).toHaveLength(0)
  } finally { jev.stop() }
}, 30_000)

test('a row with only a model takes the provider of the candidate with that model', async () => {
  const opus = parseDecision(await decide({ prompt: 'p', model: 'claude-opus-5-5' }))
  expect(opus).toMatchObject({ provider: 'claude', model: 'claude-opus-5-5', source: 'explicit' })
  const flash = parseDecision(await decide({ prompt: 'p', model: 'gemini-3.7-flash-high' }))
  expect(flash).toMatchObject({ provider: 'gemini', model: 'gemini-3.7-flash-high', source: 'explicit' })
  const luna = parseDecision(await decide({ prompt: 'p', model: 'gpt-5.6-luna' }))
  expect(luna).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna', source: 'explicit' })
}, 30_000)

test('a row with only an unknown model defaults the provider to claude', async () => {
  const d = parseDecision(await decide({ prompt: 'p', model: 'some-model-9' }))
  expect(d).toMatchObject({ provider: 'claude', model: 'some-model-9', source: 'explicit' })
}, 30_000)

test('a row with only a provider has a null model', async () => {
  const d = parseDecision(await decide({ prompt: 'p', provider: 'gemini' }))
  expect(d.provider).toBe('gemini')
  expect(d.model).toBeNull()
  expect(d.source).toBe('explicit')
}, 30_000)

// ---------------------------------------------------------------------------- table rows

test('each kind routes to its pick candidate', async () => {
  const want: Record<string, [string, string, string]> = {
    script: ['sonnet', 'claude', 'claude-sonnet-5-5'],
    judgement: ['opus', 'claude', 'claude-opus-5-5'],
    review: ['sonnet', 'claude', 'claude-sonnet-5-5'],
    bulk: ['flash', 'gemini', 'gemini-3.7-flash-high'],
  }
  for (const kind of KINDS) {
    const d = parseDecision(await decide({ label: kind, prompt: 'p', kind }))
    const [candidate, provider, model] = want[kind]
    expect(d).toMatchObject({ kind, candidate, provider, model, source: 'table' })
  }
}, 60_000)

test('an unavailable pick falls back to the first available fallback', async () => {
  const table = fixtureCopy(t => { t.candidates.sonnet.available = false })
  const d = parseDecision(await decide({ prompt: 'p', kind: 'script' }, table))
  expect(d).toMatchObject({ kind: 'script', candidate: 'flash', provider: 'gemini', model: 'gemini-3.7-flash-high', source: 'table' })
}, 30_000)

test('an unavailable fallback is skipped for the next available one', async () => {
  const table = fixtureCopy(t => {
    t.candidates.flash.available = false
    t.kinds.bulk.fallbacks = ['luna', 'sonnet']
    t.candidates.luna.available = false
  })
  const d = parseDecision(await decide({ prompt: 'p', kind: 'bulk' }, table))
  expect(d).toMatchObject({ kind: 'bulk', candidate: 'sonnet', provider: 'claude', source: 'table' })
}, 30_000)

test('a kind whose pick and every fallback are unavailable exits 2', async () => {
  const table = fixtureCopy(t => { t.candidates.sonnet.available = false; t.candidates.flash.available = false })
  const r = await decide({ prompt: 'p', kind: 'script' }, table)
  expect(r.code).toBe(2)
  expect(r.stdout.trim()).toBe('')
}, 30_000)

test('a row with no provider, model or kind exits 2 and names every kind', async () => {
  const r = await decide({ label: 'x', prompt: 'p' })
  expect(r.code).toBe(2)
  expect(r.stdout).toBe('')
  for (const k of KINDS) expect(r.stderr).toContain(k)
}, 30_000)

test('an unknown kind exits 2 and names every kind', async () => {
  const r = await decide({ label: 'x', prompt: 'p', kind: 'poetry' })
  expect(r.code).toBe(2)
  expect(r.stdout).toBe('')
  for (const k of KINDS) expect(r.stderr).toContain(k)
}, 30_000)

test('--table beats ROUTING_TABLE', async () => {
  const other = fixtureCopy(t => { t.kinds.script.pick = 'opus' })
  const d = parseDecision(await decide({ prompt: 'p', kind: 'script' }, FIXTURE, { ROUTING_TABLE: other }))
  expect(d.candidate).toBe('sonnet')
}, 30_000)

test('ROUTING_TABLE is used when --table is absent', async () => {
  const other = fixtureCopy(t => { t.kinds.script.pick = 'opus' })
  const d = parseDecision(await runCli(['--row', JSON.stringify({ prompt: 'p', kind: 'script' })], { ROUTING_TABLE: other }))
  expect(d).toMatchObject({ candidate: 'opus', model: 'claude-opus-5-5', source: 'table' })
}, 30_000)

// ------------------------------------------------------------------- shadow retired 2026-10-02

test('a table-routed row makes no Decisions call and carries no shadow field', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.9, flash: 0.9, luna: 0.9 }))
  try {
    for (const kind of KINDS) {
      const d = parseDecision(await decide({ label: 'L', prompt: 'p', kind }, FIXTURE, { WORK_HOLD_DECISIONS_URL: jev.url }))
      expect(d.source).toBe('table')
      expect('shadow' in d).toBe(false)
    }
    expect(jev.bodies).toHaveLength(0)
  } finally { jev.stop() }
}, 60_000)

test('a table still carrying the retired jev key is refused, naming it', async () => {
  const table = fixtureCopy(t => { t.jev = { mode: 'shadow', model: 'typesafe/jev-1.13', threshold: 0.85, timeoutSeconds: 10 } })
  const r = await decide({ prompt: 'p', kind: 'script' }, table)
  expect(r.code).toBe(1)
  expect(r.stdout).toBe('')
  expect(r.stderr).toContain('jev is retired')
  expect(() => loadTable(table)).toThrow(/jev is retired/)
}, 30_000)

// -------------------------------------------------------------------------------- outcomes

const OUT_LINES = [
  { type: 'row', rowId: 'a', kind: 'script', route: { model: 'm-sonnet' } },
  { type: 'row', rowId: 'b', kind: 'script', route: { model: 'm-sonnet' } },
  { type: 'row', rowId: 'c', kind: 'script', route: { model: 'm-sonnet' } },
  { type: 'row', rowId: 'd', kind: 'judgement', route: { model: null, provider: 'claude' }, models: ['m-opus'] },
  { type: 'row', rowId: 'e', kind: 'judgement', route: { model: null, provider: 'codex' } },
  { type: 'verdict', rowId: 'a', verdict: 'wrong', checks: ['verify', 'lens:major'] },
  { type: 'verdict', rowId: 'b', verdict: 'wrong', checks: ['lens:major'] },
  { type: 'verdict', rowId: 'c', verdict: 'wrong', checks: ['red'] },
  // A later hand verdict overrides the automatic one for the same rowId.
  { type: 'verdict', rowId: 'c', verdict: 'correct', why: 'checked by hand' },
  { type: 'verdict', rowId: 'd', verdict: 'wrong', why: 'by hand' },
  { type: 'verdict', rowId: 'zz', verdict: 'wrong', checks: ['orphan'] },
]
const outcomesFile = () => {
  const p = join(mkTmp('route-outcomes-'), 'farm-outcomes.jsonl')
  writeFileSync(p, OUT_LINES.map(l => JSON.stringify(l)).join('\n') + '\n{torn line\n')
  return p
}

test('--outcomes --json: per kind x model rows, labelled, wrong rate, top failing checks', async () => {
  const r = await runCli(['--outcomes', '--file', outcomesFile(), '--json'])
  expect(r.code).toBe(0)
  const groups = JSON.parse(r.stdout)
  expect(groups).toEqual([
    { kind: 'judgement', model: 'codex:(unpinned)', rows: 1, labelled: 0, wrong: 0, wrongRate: null, topChecks: [] },
    { kind: 'judgement', model: 'm-opus', rows: 1, labelled: 1, wrong: 1, wrongRate: 1, topChecks: [{ check: '(unnamed)', count: 1 }] },
    { kind: 'script', model: 'm-sonnet', rows: 3, labelled: 3, wrong: 2, wrongRate: 2 / 3,
      topChecks: [{ check: 'lens:major', count: 2 }, { check: 'verify', count: 1 }] },
  ])
}, 30_000)

test('--outcomes prints a table and never writes the file it reads', async () => {
  const f = outcomesFile()
  const before = readFileSync(f, 'utf8')
  const r = await runCli(['--outcomes', '--file', f])
  expect(r.code).toBe(0)
  expect(r.stdout.split('\n')[0]).toBe('kind\tmodel\trows\tlabelled\twrong\twrong_rate\ttop_failing_checks')
  expect(r.stdout).toContain('script\tm-sonnet\t3\t3\t2\t0.67\tlens:major (2), verify (1)')
  expect(readFileSync(f, 'utf8')).toBe(before)
}, 30_000)

test('--outcomes reads FARM_OUTCOMES when --file is absent, and exits 2 on a missing file', async () => {
  const f = outcomesFile()
  const r = await runCli(['--outcomes', '--json'], { FARM_OUTCOMES: f })
  expect(r.code).toBe(0)
  expect(JSON.parse(r.stdout)).toHaveLength(3)
  const missing = await runCli(['--outcomes'], { FARM_OUTCOMES: join(mkTmp('route-outcomes-'), 'absent.jsonl') })
  expect(missing.code).toBe(2)
  expect(missing.stderr).toContain('no outcomes file')
}, 30_000)

// ------------------------------------------------------------------------ committed table

test('the committed routing.json is well formed', () => {
  expect(existsSync(COMMITTED)).toBe(true)
  const t = JSON.parse(readFileSync(COMMITTED, 'utf8'))
  expect(Object.keys(t.kinds).sort()).toEqual([...KINDS].sort())
  for (const k of KINDS) {
    for (const id of [t.kinds[k].pick, ...t.kinds[k].fallbacks]) expect(Object.keys(t.candidates)).toContain(id)
  }
  for (const c of Object.values(t.candidates) as any[]) {
    expect(c.model).toMatch(/\d/)
    expect(['opus', 'sonnet', 'haiku']).not.toContain(c.model)
  }
  expect(t.candidates[t.kinds.judgement.pick].model).toMatch(/^claude-opus-/)
  expect('jev' in t).toBe(false)
  expect(Object.keys(loadTable(COMMITTED).candidates).length).toBeGreaterThan(0)
})
