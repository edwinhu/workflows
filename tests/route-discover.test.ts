import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'

/**
 * The spec for `route.ts --propose`'s DISCOVERY section: a model the proxy serves that no candidate
 * names yet, of a candidate's owner and family, with a strictly higher AA index at <= its price.
 *
 * The proxy, OpenRouter and Artificial Analysis are one in-test Bun.serve; the AA key is a sentinel
 * env var, so nothing reaches the network or 1Password, and the table is always a temp copy.
 */

const ROUTE = join(import.meta.dir, '..', 'scripts', 'lib', 'route.ts')
const FIXTURE = join(import.meta.dir, 'fixtures', 'routing', 'table.json')
const DEAD = 'http://127.0.0.1:1'
const AA_KEY = 'aa-SENTINEL-d15c0'
const OR_KEY = 'or-SENTINEL-d15c0'

const CATALOG = [
  { id: 'claude-sonnet-5-5', owned_by: 'anthropic' },
  { id: 'claude-opus-5-5', owned_by: 'anthropic' },
  { id: 'gemini-3.7-flash-high', owned_by: 'antigravity' },
  { id: 'gpt-5.6-luna', owned_by: 'openai' },
  { id: 'gpt-6-luna', owned_by: 'openai' },
  { id: 'gpt-6.1-sol', owned_by: 'openai' },
]
const PRICES = [
  { id: 'openai/gpt-5.6-luna', pricing: { prompt: '0.0000002', completion: '0.0000012' } },
  { id: 'openai/gpt-6-luna', pricing: { prompt: '0.0000001', completion: '0.0000005' } },
  { id: 'openai/gpt-6-luna:batch', pricing: { prompt: '0.00000005', completion: '0.00000025' } },
  { id: 'openai/gpt-6.1-sol', pricing: { prompt: '0.0000001', completion: '0.00001' } },
  { id: 'anthropic/claude-sonnet-5.5', pricing: { prompt: '0.000002', completion: '0.00001' } },
]
const aa = (creator: string, slug: string, index: number) => ({
  slug, model_creator: { slug: creator }, evaluations: { artificial_analysis_intelligence_index: index },
})
const AA = [aa('openai', 'gpt-5-6-luna', 37.3), aa('openai', 'gpt-6-luna', 38.1), aa('openai', 'gpt-6-1-sol', 51.8)]

/** The fixture with luna carrying an openrouter slug, as the real table does. */
function tableCopy(edit: (t: any) => void = () => {}): string {
  const t = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  t.candidates.luna.openrouter = 'openai/gpt-5.6-luna'
  t.candidates.luna.price = { prompt: 2e-7, completion: 1.2e-6 }
  edit(t)
  const p = join(mkdtempSync(join(tmpdir(), 'route-discover-')), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2) + '\n')
  return p
}

function stub(opts: { catalog?: unknown[]; prices?: unknown[]; aa?: unknown[]; rankings?: unknown[] } = {}) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/v1/models') return Response.json({ data: opts.catalog ?? CATALOG })
      if (path === '/prices') return Response.json({ data: opts.prices ?? PRICES })
      if (path === '/aa') return Response.json({ data: opts.aa ?? AA })
      if (path === '/rankings') return Response.json({ meta: { as_of: '2026-10-02' }, data: opts.rankings ?? [] })
      return new Response('not found', { status: 404 })
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  return {
    env: { ROUTE_PROXY_URL: `${base}/v1/models`, ROUTE_PRICES_URL: `${base}/prices`, ROUTE_AA_URL: `${base}/aa`, ROUTE_RANKINGS_URL: `${base}/rankings` },
    stop: () => server.stop(true),
  }
}

async function propose(table: string, env: Record<string, string>, json = true) {
  const { ROUTING_TABLE: _t, OPENROUTER_API_KEY: _o, OP_SERVICE_ACCOUNT_TOKEN: _s, ...base } =
    HERMETIC_ENV as Record<string, string>
  const dir = mkdtempSync(join(tmpdir(), 'route-discover-env-'))
  const p = Bun.spawn(['bun', ROUTE, '--propose', ...(json ? ['--json'] : []), '--table', table], {
    env: {
      ...base, TMPDIR: dir, FARM_OUTCOMES: join(dir, 'outcomes.jsonl'),
      ROUTE_PROXY_URL: `${DEAD}/v1/models`, ROUTE_PRICES_URL: `${DEAD}/prices`, ROUTE_AA_URL: `${DEAD}/aa`,
      ROUTE_RANKINGS_URL: `${DEAD}/rankings`, ARTIFICIAL_ANALYSIS_API_KEY: AA_KEY, OPENROUTER_API_KEY: OR_KEY,
      ROUTE_AA_KEY_FILE: join(dir, 'no-key'), ROUTE_OPENROUTER_KEY_FILE: join(dir, 'no-key'), ...env,
    },
    stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 20_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr }
}

test('discovery: a newer same-family model at a lower price is proposed, and the table is not written', async () => {
  const s = stub()
  try {
    const table = tableCopy()
    const before = readFileSync(table, 'utf8')
    const j = await propose(table, s.env)
    expect(j.code).toBe(0)
    expect(JSON.parse(j.stdout).discoveries).toEqual([
      {
        candidate: 'luna', from: 'gpt-5.6-luna', to: 'gpt-6-luna', openrouter: 'openai/gpt-6-luna',
        index: { from: 37.3, to: 38.1 }, price: { from: 2e-7, to: 1e-7 },
      },
    ])
    const t = await propose(table, s.env, false)
    expect(t.code).toBe(0)
    expect(t.stdout).toContain('candidate luna: model gpt-5.6-luna -> gpt-6-luna (index 37.3 -> 38.1, price 2e-7 -> 1e-7)')
    expect(readFileSync(table, 'utf8')).toBe(before)
  } finally {
    s.stop()
  }
}, 30_000)

test('discovery: a same-family model that is pricier is not proposed', async () => {
  const s = stub({
    prices: PRICES.map(p => (p.id === 'openai/gpt-6-luna' ? { ...p, pricing: { prompt: '0.0000003', completion: '0.000001' } } : p)),
  })
  try {
    const j = await propose(tableCopy(), s.env)
    expect(j.code).toBe(0)
    expect(JSON.parse(j.stdout).discoveries).toEqual([])
  } finally {
    s.stop()
  }
}, 30_000)

test('discovery: a higher-index cheaper model of a DIFFERENT family is not proposed', async () => {
  // gpt-6.1-sol is openai, index 51.8, prompt 1e-7 <= luna's 2e-7 — but its family is sol, not luna.
  const s = stub({ catalog: CATALOG.filter(m => m.id !== 'gpt-6-luna') })
  try {
    const j = await propose(tableCopy(), s.env)
    expect(j.code).toBe(0)
    expect(JSON.parse(j.stdout).discoveries).toEqual([])
  } finally {
    s.stop()
  }
}, 30_000)

test('discovery: a model some candidate already names is not proposed', async () => {
  const s = stub()
  try {
    const table = tableCopy(t => {
      t.candidates.luna6 = {
        provider: 'codex', model: 'gpt-6-luna', owner: 'openai', openrouter: 'openai/gpt-6-luna',
        available: true, price: { prompt: 1e-7, completion: 5e-7 },
      }
    })
    const j = await propose(table, s.env)
    expect(j.code).toBe(0)
    expect(JSON.parse(j.stdout).discoveries).toEqual([])
  } finally {
    s.stop()
  }
}, 30_000)

test('discovery: an unreachable proxy skips discovery with a stderr line and still exits 0', async () => {
  const s = stub()
  try {
    const j = await propose(tableCopy(), { ...s.env, ROUTE_PROXY_URL: `${DEAD}/v1/models` })
    expect(j.code).toBe(0)
    expect(JSON.parse(j.stdout).discoveries).toEqual([])
    expect(j.stderr).toMatch(/^route --propose: discovery skipped: proxy catalog .* unreachable/m)
  } finally {
    s.stop()
  }
}, 30_000)

// Two newer luna-family models, both index 40 and both cheaper than luna's 2e-7: gpt-6-luna at 1e-7, gpt-7-luna at 5e-8.
const RANK_CATALOG = [...CATALOG, { id: 'gpt-7-luna', owned_by: 'openai' }]
const RANK_PRICES = [...PRICES, { id: 'openai/gpt-7-luna', pricing: { prompt: '0.00000005', completion: '0.00000025' } }]
const RANK_AA = [aa('openai', 'gpt-5-6-luna', 37.3), aa('openai', 'gpt-6-luna', 40), aa('openai', 'gpt-7-luna', 40)]
// OpenRouter ranks by total_tokens, so a smaller n here means more tokens and a better rank; ranks are never tied.
const rank = (id: string, n: number) => ({ model_permaslug: id, total_tokens: 1e9 / n })

async function lunaTo(rankings: unknown[], aaRows = RANK_AA) {
  const s = stub({ catalog: RANK_CATALOG, prices: RANK_PRICES, aa: aaRows, rankings })
  try {
    const j = await propose(tableCopy(), s.env)
    expect(j.code).toBe(0)
    return JSON.parse(j.stdout).discoveries.map((d: any) => d.to)
  } finally {
    s.stop()
  }
}

test('discovery rank: on an index tie the more-used model wins even when pricier', async () => {
  expect(await lunaTo([rank('openai/gpt-6-luna', 4), rank('openai/gpt-7-luna', 30)])).toEqual(['gpt-6-luna'])
}, 30_000)

test('discovery rank: with neither model ranked the lower price wins', async () => {
  expect(await lunaTo([])).toEqual(['gpt-7-luna'])
  expect(await lunaTo([rank('openai/some-other-model', 1)])).toEqual(['gpt-7-luna'])
}, 30_000)

test('discovery rank: a higher index beats better usage', async () => {
  const aaRows = [aa('openai', 'gpt-5-6-luna', 37.3), aa('openai', 'gpt-6-luna', 41), aa('openai', 'gpt-7-luna', 40)]
  expect(await lunaTo([rank('openai/gpt-6-luna', 30), rank('openai/gpt-7-luna', 1)], aaRows)).toEqual(['gpt-6-luna'])
}, 30_000)
