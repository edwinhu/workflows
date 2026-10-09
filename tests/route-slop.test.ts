import { test, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'
import { matchSlop, parseJsLiteral, parseSlopBundle, slopFrontier } from '../scripts/lib/route.ts'

const mkTmp = useTmp()

/**
 * The spec for the slopalytics source (`route.ts --refresh`), the Pareto-dominance pick rule and
 * the FRONTIER/EFFORT notes of `route.ts --propose` (decided 2026-10-08).
 *
 * slopalytics' index.html and bundle are fixtures served by an in-test Bun.serve; every other
 * source is dead, so nothing reaches the network, and the table is always a temp copy.
 */

const ROUTE = join(import.meta.dir, '..', 'scripts', 'lib', 'route.ts')
const FIXTURES = join(import.meta.dir, 'fixtures', 'routing')
const FIXTURE = join(FIXTURES, 'table.json')
const INDEX = readFileSync(join(FIXTURES, 'slop-index.html'), 'utf8')
const BUNDLE = readFileSync(join(FIXTURES, 'slop-bundle.js'), 'utf8')
const BUNDLE_PATH = '/assets/index-Bx7fT2qa.js'
const FETCHED = '2026-10-08T02:04:01.676Z'
const DEAD = 'http://127.0.0.1:1'

const CATALOG = [
  { id: 'claude-sonnet-5-5', owned_by: 'anthropic' },
  { id: 'claude-opus-5-5', owned_by: 'anthropic' },
  { id: 'gemini-3.7-flash-high', owned_by: 'antigravity' },
  { id: 'gemini-3.8-flash-high', owned_by: 'antigravity' },
  { id: 'gpt-5.6-luna', owned_by: 'openai' },
  { id: 'gpt-6.1-sol', owned_by: 'openai' },
]

function tableCopy(edit: (t: any) => void = () => {}): string {
  const t = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  edit(t)
  const p = join(mkTmp('route-slop-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2) + '\n')
  return p
}

/** The proxy catalog and slopalytics. `index`/`bundle` override what the two slop paths answer. */
function stub(opts: { index?: string | number; bundle?: string | number } = {}) {
  const seen: string[] = []
  const answer = (v: string | number, type: string) =>
    typeof v === 'number' ? new Response('no', { status: v }) : new Response(v, { headers: { 'content-type': type } })
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      seen.push(path)
      if (path === '/v1/models') return Response.json({ data: CATALOG })
      if (path === '/') return answer(opts.index ?? INDEX, 'text/html')
      if (path === BUNDLE_PATH) return answer(opts.bundle ?? BUNDLE, 'text/javascript')
      return new Response('not found', { status: 404 })
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  return { env: { ROUTE_PROXY_URL: `${base}/v1/models`, ROUTE_SLOP_URL: `${base}/` }, seen, stop: () => server.stop(true) }
}

async function run(args: string[], env: Record<string, string>) {
  const { ROUTING_TABLE: _t, OPENROUTER_API_KEY: _o, ARTIFICIAL_ANALYSIS_API_KEY: _a, OP_SERVICE_ACCOUNT_TOKEN: _s, ...base } =
    HERMETIC_ENV as Record<string, string>
  const dir = mkTmp('route-slop-env-')
  const p = Bun.spawn(['bun', ROUTE, ...args], {
    env: {
      ...base, TMPDIR: dir, ROUTE_PROXY_URL: `${DEAD}/v1/models`, ROUTE_PRICES_URL: `${DEAD}/prices`,
      ROUTE_RANKINGS_URL: `${DEAD}/rankings`, ROUTE_AA_URL: `${DEAD}/aa`, ROUTE_SLOP_URL: `${DEAD}/`,
      OPENROUTER_API_KEY: 'test-or-key', ARTIFICIAL_ANALYSIS_API_KEY: 'test-aa-key',
      WORK_HOLD_DECISIONS_URL: `${DEAD}/`, WORK_HOLD_JUDGE_TOKEN: 'test-token', ...env,
    },
    stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 20_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr }
}

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

// ------------------------------------------------------------------------------- the parser

test('the literal parser reads backtick strings, !0/!1, bare keys and leading-dot numbers, and never interpolates', () => {
  expect(parseJsLiteral('{a:`x}y`,b:!0,c:!1,d:.82,e:-.5,f:1e6,"g":[null,void 0],h:`a\\`b`}').value).toEqual({
    a: 'x}y', b: true, c: false, d: 0.82, e: -0.5, f: 1e6, g: [null, null], h: 'a`b',
  })
  expect(() => parseJsLiteral('{a:`${globalThis.x}`}')).toThrow(/template interpolation/)
  expect(() => parseJsLiteral('{a:fetch(1)}')).toThrow(/unexpected/)
})

test('frontier: non-deprecated, both values known, and no other variant both better and cheaper', () => {
  const d = parseSlopBundle(BUNDLE)
  expect(d.fetchedAt).toBe(FETCHED)
  expect(d.models).toHaveLength(14)
  // old-model (99 at $0.001) is deprecated and no-cost has no cost: neither is on the line nor dominates.
  // sonnet max (56, $5.46) loses to opus xhigh (56.5, $3.46); sonnet high and both 3.8 flashes lose to sol.
  expect([...slopFrontier(d.models)].sort()).toEqual(
    ['claude-opus-5-5', 'claude-opus-5-5-xhigh', 'deepseek-x', 'gpt-6-1-sol', 'gpt-6-1-sol-low', 'gpt-6-luna'],
  )
})

test('matching: exact id after dots -> dashes, else the family variant of the same effort, else its max effort', () => {
  const { models } = parseSlopBundle(BUNDLE)
  const m = (id: string) => matchSlop(id, models)?.id ?? null
  expect(m('gpt-6.1-sol')).toBe('gpt-6-1-sol')
  expect(m('gemini-3.8-flash-medium')).toBe('gemini-3-8-flash-medium')
  expect(m('gemini-3.7-flash-high')).toBe('gemini-3-7-flash')
  expect(m('gemini-3.8-flash-xhigh')).toBe('gemini-3-8-flash')
  expect(m('gpt-5.6-luna')).toBeNull()
})

// ---------------------------------------------------------------------------------- refresh

test('refresh: the bundle parses into slop signals for every candidate, one request per slop URL', async () => {
  const s = stub()
  const table = tableCopy(t => {
    t.candidates.sol = { provider: 'codex', model: 'gpt-6.1-sol', owner: 'openai', openrouter: null, available: true, price: null }
  })
  try {
    const r = await run(['--refresh', '--table', table], s.env)
    expect(r.code).toBe(0)
    expect(s.seen.filter(p => p === '/')).toHaveLength(1)
    expect(s.seen.filter(p => p === BUNDLE_PATH)).toHaveLength(1)
    const c = read(table).candidates
    expect(c.sonnet.signals).toMatchObject({
      usageRank: null, intelligenceIndex: null,
      slopVariant: 'claude-sonnet-5-5', slopIntelligence: 56, slopCost: 5.46, onFrontier: false, slopAsOf: FETCHED,
    })
    expect(c.opus.signals).toMatchObject({ slopVariant: 'claude-opus-5-5', slopIntelligence: 57.6, slopCost: 5.98, onFrontier: true })
    expect(c.flash.signals).toMatchObject({ slopVariant: 'gemini-3-7-flash', slopIntelligence: 39, slopCost: 0.92, onFrontier: false })
    expect(c.sol.signals).toMatchObject({ slopVariant: 'gpt-6-1-sol', slopIntelligence: 51.8, slopCost: 0.72, onFrontier: true })
    // luna names no variant in the dataset.
    expect(c.luna.signals).toMatchObject({ slopVariant: null, slopIntelligence: null, slopCost: null, onFrontier: false })
    expect(r.stdout).toContain(`Source: slopalytics (https://slopalytics.com), Artificial Analysis data fetched ${FETCHED}.`)
    expect(r.stdout).toContain('sonnet: slopVariant null -> "claude-sonnet-5-5"')
  } finally { s.stop() }
}, 30_000)

test('refresh: a missing or garbled bundle leaves every slop signal unchanged, warns, and exits 0', async () => {
  const prior = {
    usageRank: 4, intelligenceIndex: 50, asOf: '2026-10-02',
    slopVariant: 'claude-sonnet-5-5', slopIntelligence: 1, slopCost: 2, onFrontier: true, slopAsOf: '2026-10-01T00:00:00Z',
  }
  for (const opts of [
    { index: 404 },
    { index: '<html><body>no script here</body></html>' },
    { bundle: 500 },
    { bundle: 'const x={fetchedAt:`2026`,models:[{id:`a`,family:' },
    { bundle: 'console.log("no dataset")' },
  ]) {
    const s = stub(opts)
    const table = tableCopy(t => { t.candidates.sonnet.signals = prior })
    try {
      const r = await run(['--refresh', '--table', table], s.env)
      expect(r.code).toBe(0)
      expect(r.stderr).toMatch(/^route --refresh: slop signals left unchanged: slopalytics .* failed/m)
      const c = read(table).candidates
      expect(c.sonnet.signals).toEqual(prior)
      expect(c.opus.signals).toBeUndefined()
    } finally { s.stop() }
  }
}, 60_000)

// ---------------------------------------------------------------------------------- propose

const slopSig = (slopIntelligence: number, slopCost: number) => ({
  usageRank: null, intelligenceIndex: null, asOf: '2026-10-08',
  slopVariant: 'x', slopIntelligence, slopCost, onFrontier: false, slopAsOf: FETCHED,
})

/** The fixture plus flash38 (bulk's pick here) and sol, with slop signals on every candidate. */
function paretoTable(edit: (t: any) => void = () => {}): string {
  return tableCopy(t => {
    t.candidates.flash38 = {
      provider: 'gemini', model: 'gemini-3.8-flash-high', owner: 'antigravity', openrouter: null, available: true, price: null,
    }
    t.candidates.sol = { provider: 'codex', model: 'gpt-6.1-sol', owner: 'openai', openrouter: null, available: true, price: null }
    t.kinds.bulk = { pick: 'flash38', fallbacks: ['sonnet', 'flash'] }
    const v: Record<string, [number, number]> = {
      sonnet: [56, 5.46], opus: [57.6, 5.98], flash: [39, 0.92], luna: [20, 0.5], flash38: [40.9, 1.24], sol: [51.8, 0.72],
    }
    for (const [id, [i, c]] of Object.entries(v)) t.candidates[id].signals = slopSig(i, c)
    edit(t)
  })
}

async function proposals(table: string) {
  const r = await run(['--propose', '--json', '--table', table], {})
  expect(r.code).toBe(0)
  return Object.fromEntries(JSON.parse(r.stdout).proposals.map((p: any) => [p.kind, p]))
}

test('propose: a cross-provider dominator replaces bulk\'s pick, which becomes a fallback', async () => {
  const table = paretoTable()
  const before = readFileSync(table, 'utf8')
  const p = await proposals(table)
  // Fallbacks keep RANK ORDER: no AA index or usage here, so price.prompt puts flash before sonnet; flash38 has none.
  expect(p.bulk.to).toEqual({ pick: 'sol', fallbacks: ['flash', 'sonnet', 'flash38'] })
  expect(p.bulk.reason).toContain('sol dominates flash38 on the slopalytics Pareto line')
  expect(p.bulk.reason).toContain('cross-provider gemini -> codex')
  expect(readFileSync(table, 'utf8')).toBe(before)
  const t = await run(['--propose', '--table', table], {})
  expect(t.stdout).toMatch(/^kind bulk: flash38 \[sonnet, flash\] -> sol \[flash, sonnet, flash38\] — sol dominates flash38/m)
}, 30_000)

test('propose: among dominators the higher slopIntelligence wins, then the lower slopCost', async () => {
  const addSol2 = (i: number, c: number) => (t: any) => {
    t.candidates.sol2 = { ...t.candidates.sol, model: 'gpt-6.1-sol-high', signals: slopSig(i, c) }
  }
  expect((await proposals(paretoTable(addSol2(52, 1.0)))).bulk.to.pick).toBe('sol2')
  expect((await proposals(paretoTable(addSol2(51.8, 0.5)))).bulk.to.pick).toBe('sol2')
  expect((await proposals(paretoTable(addSol2(51.8, 0.9)))).bulk.to.pick).toBe('sol')
}, 30_000)

test('propose: an unavailable, a merely cheaper, or an unscored candidate never dominates', async () => {
  for (const edit of [
    (t: any) => { t.candidates.sol.available = false },
    (t: any) => { t.candidates.sol.signals = slopSig(40, 0.1) },
    (t: any) => { t.candidates.sol.signals = { ...slopSig(0, 0), slopIntelligence: null } },
  ])
    expect((await proposals(paretoTable(edit))).bulk?.to.pick ?? 'flash38').toBe('flash38')
}, 30_000)

test('propose: a non-Claude dominator is never proposed for script, review or judgement', async () => {
  // sol dominates every pick here, opus included.
  const p = await proposals(paretoTable(t => { t.candidates.sol.signals = slopSig(99, 0.01) }))
  expect(p.script?.to.pick ?? 'sonnet').toBe('sonnet')
  expect(p.review?.to.pick ?? 'sonnet').toBe('sonnet')
  expect(p.judgement?.to.pick ?? 'opus').toBe('opus')
  expect(p.bulk.to.pick).toBe('sol')
}, 30_000)

test('propose: a dominating Claude candidate may replace script and review, never judgement', async () => {
  const p = await proposals(paretoTable(t => {
    t.candidates.opusx = { ...t.candidates.opus, model: 'claude-opus-5-5-xhigh', signals: slopSig(99, 0.01) }
  }))
  expect(p.script.to.pick).toBe('opusx')
  expect(p.review.to.pick).toBe('opusx')
  expect(p.judgement?.to.pick ?? 'opus').toBe('opus')
}, 30_000)

test('propose: frontier variants of served labs that no candidate names, and the Claude effort that would dominate', async () => {
  const s = stub()
  const table = paretoTable()
  try {
    const r = await run(['--propose', '--json', '--table', table], s.env)
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    // deepseek-x is on the line but its lab is not served; claude-opus-5-5 and gpt-6-1-sol are matched by candidates.
    expect(out.frontier.map((f: any) => f.variant)).toEqual(['gpt-6-luna', 'gpt-6-1-sol-low', 'claude-opus-5-5-xhigh'])
    expect(out.effort).toEqual([
      { kind: 'script', pick: 'sonnet', pickVariant: 'claude-sonnet-5-5', pickIntelligence: 56, pickCost: 5.46,
        variant: 'claude-opus-5-5-xhigh', intelligence: 56.5, cost: 3.46 },
      { kind: 'review', pick: 'sonnet', pickVariant: 'claude-sonnet-5-5', pickIntelligence: 56, pickCost: 5.46,
        variant: 'claude-opus-5-5-xhigh', intelligence: 56.5, cost: 3.46 },
    ])
    expect(read(table).kinds.script.pick).toBe('sonnet')
    const t = await run(['--propose', '--table', table], s.env)
    expect(t.stdout).toContain('frontier: gpt-6-1-sol-low (intelligence 42.1, $0.130/task) not in table')
    expect(t.stdout).toMatch(/^effort: kind script: claude-opus-5-5-xhigh \(intelligence 56\.5, \$3\.460\/task\) would dominate sonnet/m)
  } finally { s.stop() }
}, 30_000)
