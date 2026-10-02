import { test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
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
 * Every Jev case runs the CLI with an ASYNC spawn. `decisionsCall` blocks on spawnSync(curl), so an
 * in-process route() against an in-test Bun.serve would wait on the event loop it is blocking.
 * In-process API calls are made only where Jev is not consulted or is the dead port.
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
  expect(t.jev.mode).toBe('shadow')
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

// ---------------------------------------------------------------------------------- shadow

test('shadow: one Decisions call, one CORRECT/WRONG choice question per candidate in the kind chain', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.6, opus: 0.7, flash: 0.8, luna: 0.95 }))
  try {
    const d = parseDecision(await decide({ label: 'L', prompt: 'p', kind: 'script' }, FIXTURE,
      { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(jev.bodies).toHaveLength(1)
    const body = jev.bodies[0]
    expect(body.model).toBe('typesafe/jev-1.13')
    // script's chain is sonnet then flash: opus and luna are not asked about.
    expect(Object.keys(body.questions).sort()).toEqual(['q_flash', 'q_sonnet'])
    for (const q of Object.values(body.questions) as any[]) {
      expect(q.type).toBe('choice')
      expect(JSON.stringify(q)).toContain('CORRECT')
      expect(JSON.stringify(q)).toContain('WRONG')
    }
    expect(d.shadow.scores).toEqual({ sonnet: 0.6, flash: 0.8 })
  } finally { jev.stop() }
}, 30_000)

test('shadow: the pick does not change, however Jev scores it', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.01, opus: 0.99, flash: 0.99, luna: 0.99 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'script' }, FIXTURE, { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'sonnet', model: 'claude-sonnet-5-5', source: 'table' })
    expect(d.shadow.scores.sonnet).toBe(0.01)
  } finally { jev.stop() }
}, 30_000)

test('the state sent to Jev summarises the row and never carries the prompt text', async () => {
  const prompt = 'ZEBRA-QUARTZ-7781 refactor the frobnicator and report back'
  const sha = createHash('sha256').update(prompt).digest('hex')
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.9, flash: 0.9, luna: 0.9 }))
  try {
    parseDecision(await decide({ label: 'zebra-row', prompt, kind: 'review', agent: 'ds', expect: 'out.md' }, FIXTURE,
      { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(jev.bodies).toHaveLength(1)
    const raw = JSON.stringify(jev.bodies[0])
    expect(raw).not.toContain('ZEBRA-QUARTZ-7781')
    expect(raw).not.toContain('frobnicator')
    const state = jev.bodies[0].state
    expect(typeof state).toBe('string')
    expect(() => JSON.parse(state)).not.toThrow()
    expect(state).toContain(sha)
    expect(state).toContain('"review"')
    expect(state).toContain('"zebra-row"')
    expect(state).toContain(String(prompt.length))
    expect(state).toContain('"ds"')
  } finally { jev.stop() }
}, 30_000)

test('Jev unreachable: routing still succeeds with shadow.unavailable', async () => {
  const d = parseDecision(await decide({ prompt: 'p', kind: 'script' }, FIXTURE, { WORK_HOLD_DECISIONS_URL: DEAD }))
  expect(d).toMatchObject({ candidate: 'sonnet', source: 'table' })
  expect(typeof d.shadow.unavailable).toBe('string')
  expect(d.shadow.unavailable.length).toBeGreaterThan(0)
}, 30_000)

test('Jev answering 500: routing still succeeds with shadow.unavailable', async () => {
  const jev = stubJev(() => new Response('boom', { status: 500 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'bulk' }, FIXTURE, { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'flash', source: 'table' })
    expect(typeof d.shadow.unavailable).toBe('string')
  } finally { jev.stop() }
}, 30_000)

test('Jev answering garbage: routing still succeeds with shadow.unavailable', async () => {
  const jev = stubJev(() => new Response('not json at all'))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'bulk' }, FIXTURE, { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'flash', source: 'table' })
    expect(typeof d.shadow.unavailable).toBe('string')
  } finally { jev.stop() }
}, 30_000)

test('a hanging Jev is cut off at jev.timeoutSeconds: under 8 s, still routed', async () => {
  let release: () => void = () => {}
  const hung = new Promise<void>(r => { release = r })
  const jev = stubJev(async () => { await hung; return new Response('{}') })
  try {
    const r = await decide({ prompt: 'p', kind: 'script' }, FIXTURE, { WORK_HOLD_DECISIONS_URL: jev.url })
    expect(r.ms).toBeLessThan(8_000)
    const d = parseDecision(r)
    expect(d).toMatchObject({ candidate: 'sonnet', source: 'table' })
    expect(typeof d.shadow.unavailable).toBe('string')
  } finally { release(); jev.stop() }
}, 30_000)

test('Jev in-process at the dead port: route() still returns the table pick', async () => {
  const saved = { url: process.env.WORK_HOLD_DECISIONS_URL, tok: process.env.WORK_HOLD_JUDGE_TOKEN }
  process.env.WORK_HOLD_DECISIONS_URL = DEAD
  process.env.WORK_HOLD_JUDGE_TOKEN = 'test-token'
  try {
    const d: any = await route({ prompt: 'p', kind: 'script' }, { table: loadTable(FIXTURE) })
    expect(d).toMatchObject({ candidate: 'sonnet', provider: 'claude', model: 'claude-sonnet-5-5', source: 'table' })
    expect(typeof d.shadow.unavailable).toBe('string')
  } finally {
    if (saved.url === undefined) delete process.env.WORK_HOLD_DECISIONS_URL; else process.env.WORK_HOLD_DECISIONS_URL = saved.url
    if (saved.tok === undefined) delete process.env.WORK_HOLD_JUDGE_TOKEN; else process.env.WORK_HOLD_JUDGE_TOKEN = saved.tok
  }
}, 30_000)

// ---------------------------------------------------------------------------------- decide

const DECIDE = () => fixtureCopy(t => { t.jev.mode = 'decide' })

test('decide: the cheapest available chain candidate at or above threshold wins, source jev', async () => {
  // review's chain is sonnet then opus: sonnet is cheaper and clears 0.85; opus scores higher.
  const table = fixtureCopy(t => { t.jev.mode = 'decide'; t.kinds.review = { pick: 'opus', fallbacks: ['sonnet'] } })
  const jev = stubJev(scoresReply({ sonnet: 0.88, opus: 0.97 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'review' }, table, { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'sonnet', provider: 'claude', model: 'claude-sonnet-5-5', source: 'jev', kind: 'review' })
  } finally { jev.stop() }
}, 30_000)

test('decide: a candidate outside the kind chain is never scored or chosen, however cheap and confident', async () => {
  // flash is the cheapest candidate in the table but not in judgement's chain (opus, sonnet).
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.97, flash: 0.99, luna: 0.99 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'judgement' }, DECIDE(), { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(Object.keys(jev.bodies[0].questions).sort()).toEqual(['q_opus', 'q_sonnet'])
    expect(Object.keys(d.shadow.scores).sort()).toEqual(['opus', 'sonnet'])
    expect(d).toMatchObject({ candidate: 'sonnet', source: 'jev', kind: 'judgement' })
  } finally { jev.stop() }
}, 30_000)

test('decide: a score below threshold disqualifies the cheaper candidate', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.97, flash: 0.84, luna: 0.1 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'judgement' }, DECIDE(), { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'sonnet', model: 'claude-sonnet-5-5', source: 'jev' })
  } finally { jev.stop() }
}, 30_000)

test('decide: an unavailable candidate is never chosen, however cheap and confident', async () => {
  const table = fixtureCopy(t => { t.jev.mode = 'decide'; t.candidates.flash.available = false })
  const jev = stubJev(scoresReply({ sonnet: 0.9, opus: 0.95, flash: 0.99, luna: 0.1 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'judgement' }, table, { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'sonnet', source: 'jev' })
  } finally { jev.stop() }
}, 30_000)

test('decide: when nobody clears the threshold the table pick stands, source table', async () => {
  const jev = stubJev(scoresReply({ sonnet: 0.5, opus: 0.6, flash: 0.7, luna: 0.1 }))
  try {
    const d = parseDecision(await decide({ prompt: 'p', kind: 'judgement' }, DECIDE(), { WORK_HOLD_DECISIONS_URL: jev.url }))
    expect(d).toMatchObject({ candidate: 'opus', model: 'claude-opus-5-5', source: 'table' })
  } finally { jev.stop() }
}, 30_000)

test('decide: Jev unavailable falls back to the table pick, source table', async () => {
  const d = parseDecision(await decide({ prompt: 'p', kind: 'judgement' }, DECIDE(), { WORK_HOLD_DECISIONS_URL: DEAD }))
  expect(d).toMatchObject({ candidate: 'opus', source: 'table' })
  expect(typeof d.shadow.unavailable).toBe('string')
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
  expect(t.jev.mode).toBe('shadow')
  expect(loadTable(COMMITTED).jev.mode).toBe('shadow')
  expect(loadTable().jev.mode).toBe('shadow')
})
